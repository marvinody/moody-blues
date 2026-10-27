const { Op } = require('sequelize')
const _ = require('lodash')
const db = require('../db')
const { QueuedPost, PostedProduct, Schedule } = require('../db/models')

// the bot NOTIFYs this channel after queueing posts so the sender wakes up right away
const QUEUE_NOTIFY_CHANNEL = 'post_queue'

const rowKey = ({ productId, scheduleId }) => ({ productId, scheduleId })
const byKeys = (rows) => ({ [Op.or]: rows.map(rowKey) })
const itemKey = (row) => `${row.payload.item.site}\u0000${row.payload.item.siteCode}`

const enabledScheduleIds = async (transaction) => {
  const schedules = await Schedule.findAll({
    attributes: ['id'],
    where: { enabled: true },
    raw: true,
    transaction,
  })
  return schedules.map(({ id }) => id)
}

// Claims the next message's worth of posts: the oldest ready post's webhook, and up to
// maxEmbeds distinct items for it. Every schedule's row for those items is included, so
// schedules sharing a channel get one post but are all recorded.
// Claimed rows are leased (availableAt pushed out) so a crash mid-send only delays them,
// and SKIP LOCKED keeps two senders from claiming the same rows.
const claimNextBatch = ({ now, leaseMs, maxEmbeds }) => db.transaction(async (transaction) => {
  const scheduleIds = await enabledScheduleIds(transaction)
  if (scheduleIds.length === 0) {
    return null
  }

  const ready = {
    availableAt: { [Op.lte]: now },
    scheduleId: scheduleIds,
  }
  const lock = { lock: transaction.LOCK.UPDATE, skipLocked: true, transaction }

  const next = await QueuedPost.findOne({ where: ready, order: [['createdAt', 'ASC']], ...lock })
  if (!next) {
    return null
  }

  const candidates = await QueuedPost.findAll({
    where: { ...ready, webhookURL: next.webhookURL },
    order: [['createdAt', 'ASC']],
    // a few schedules can share a webhook, so look past maxEmbeds rows
    limit: maxEmbeds * 5,
    ...lock,
  })

  const chosenItems = new Set()
  const rows = candidates.filter(row => {
    const key = itemKey(row)
    if (!chosenItems.has(key) && chosenItems.size >= maxEmbeds) {
      return false
    }
    chosenItems.add(key)
    return true
  })

  await QueuedPost.update(
    { availableAt: new Date(now.getTime() + leaseMs) },
    { where: byKeys(rows), transaction },
  )

  return { webhookURL: next.webhookURL, rows }
})

// one payload per distinct item, in queue order
const batchPayloads = (rows) => _.uniqBy(rows, itemKey).map(row => row.payload)

// discord accepted the post: record it and remove it from the queue
const completeBatch = (rows, now) => db.transaction(async (transaction) => {
  await PostedProduct.bulkCreate(
    rows.map(({ productId, scheduleId, price }) => ({ productId, scheduleId, price })),
    { updateOnDuplicate: ['price', 'updatedAt'], transaction },
  )
  // only delete rows still at the price we sent; if the bot queued a newer price meanwhile,
  // keep that row and release its lease so it goes out next
  await QueuedPost.destroy({
    where: { [Op.or]: rows.map(({ productId, scheduleId, price }) => ({ productId, scheduleId, price })) },
    transaction,
  })
  await QueuedPost.update({ availableAt: now }, { where: byKeys(rows), transaction })
})

// try these rows again later; countAttempt is false for rate limits, which aren't the post's fault
const rescheduleRows = (rows, availableAt, { countAttempt = false, error } = {}) => QueuedPost.update({
  availableAt,
  ...(countAttempt ? { attempts: db.literal('"attempts" + 1') } : {}),
  ...(error ? { lastError: error } : {}),
}, { where: byKeys(rows) })

// hold back everything queued for a webhook until it's allowed again
const pauseWebhook = (webhookURL, availableAt) => QueuedPost.update(
  { availableAt },
  { where: { webhookURL, availableAt: { [Op.lt]: availableAt } } },
)

const dropRows = (rows) => QueuedPost.destroy({ where: byKeys(rows) })

const dropWebhook = (webhookURL) => QueuedPost.destroy({ where: { webhookURL } })

// removes posts that waited too long (the listing has probably sold) or whose schedule was disabled
const cleanupQueue = async ({ now, maxAgeHours }) => {
  const tooOld = await QueuedPost.destroy({
    where: { createdAt: { [Op.lt]: new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000) } },
  })
  const scheduleIds = await enabledScheduleIds()
  const disabled = await QueuedPost.destroy({
    where: scheduleIds.length > 0 ? { scheduleId: { [Op.notIn]: scheduleIds } } : {},
  })
  return { tooOld, disabled }
}

// when the earliest waiting post becomes ready, or null if the queue is empty
const nextAvailableAt = async () => {
  const scheduleIds = await enabledScheduleIds()
  if (scheduleIds.length === 0) {
    return null
  }
  return QueuedPost.min('availableAt', { where: { scheduleId: scheduleIds } })
}

const queueSize = () => QueuedPost.count()

module.exports = {
  QUEUE_NOTIFY_CHANNEL,
  claimNextBatch,
  batchPayloads,
  completeBatch,
  rescheduleRows,
  pauseWebhook,
  dropRows,
  dropWebhook,
  cleanupQueue,
  nextAvailableAt,
  queueSize,
}
