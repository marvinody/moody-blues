const discordService = require('../services/discordService')
const { Schedule } = require('../db/models')
const makeEmbed = require('../util/makeEmbed')
const log = require('../util/logger')
const settings = require('../../config/sender')
const queue = require('./queue')

const later = (now, ms) => new Date(now.getTime() + ms)

// a block on every request is usually a ban; don't retry it quickly even if discord gave no wait time
const MIN_GLOBAL_PAUSE_MS = 60 * 1000

const retryBackoffMs = (attempts) => Math.min(
  settings.SENDER_RETRY_BACKOFF_BASE_MS * 2 ** (attempts - 1),
  settings.SENDER_RETRY_BACKOFF_MAX_MS,
)

// Sends at most one webhook message from the queue.
// Resolves { idle: true } when nothing is ready, { pauseAllMs } when discord blocked
// every request, and {} otherwise.
const processNextBatch = async ({ now = new Date() } = {}) => {
  const batch = await queue.claimNextBatch({
    now,
    leaseMs: settings.SENDER_CLAIM_LEASE_MS,
    maxEmbeds: settings.SENDER_MAX_EMBEDS_PER_POST,
  })
  if (!batch) {
    return { idle: true }
  }

  const { webhookURL, rows } = batch
  const webhookId = discordService.webhookId(webhookURL)
  const embeds = queue.batchPayloads(rows).map(makeEmbed)
  const result = await discordService.sendWebhook(webhookURL, embeds)

  if (result.ok) {
    await queue.completeBatch(rows, now)
    log.info(`Sent ${embeds.length} item(s) to webhook ${webhookId}`)
    // out of requests for this webhook: wait for discord's reset instead of hitting a 429
    if (result.remaining === 0 && result.resetAfterMs) {
      await queue.pauseWebhook(webhookURL, later(now, result.resetAfterMs))
    }
    return {}
  }

  if (result.status === 429) {
    const waitMs = result.isGlobal ? Math.max(result.retryAfterMs, MIN_GLOBAL_PAUSE_MS) : result.retryAfterMs
    await queue.rescheduleRows(rows, later(now, waitMs))
    if (result.isGlobal) {
      log.warn(`Discord blocked all requests, pausing sending for ${Math.round(waitMs / 1000)}s`)
      return { pauseAllMs: waitMs }
    }
    log.warn(`Rate limited on webhook ${webhookId}, holding its posts for ${Math.round(waitMs / 1000)}s`)
    await queue.pauseWebhook(webhookURL, later(now, waitMs))
    return {}
  }

  if (result.status === 404) {
    log.warn(`Webhook ${webhookId} is gone, disabling it and dropping its posts`)
    await Schedule.disableWebhook(webhookURL)
    await queue.dropWebhook(webhookURL)
    await discordService.postDisablingWebhook(result.error, webhookURL)
    return {}
  }

  const attempts = Math.max(...rows.map(row => row.attempts)) + 1
  if (attempts >= settings.SENDER_MAX_ATTEMPTS) {
    log.error(`Giving up on ${embeds.length} item(s) for webhook ${webhookId} after ${attempts} attempts: ${result.error.message}`)
    await queue.dropRows(rows)
    await discordService.postGenericErrorWebhook(result.error, webhookURL)
    return {}
  }

  const backoffMs = retryBackoffMs(attempts)
  log.warn(`Send to webhook ${webhookId} failed (attempt ${attempts}/${settings.SENDER_MAX_ATTEMPTS}), retrying in ${Math.round(backoffMs / 1000)}s: ${result.error.message}`)
  await queue.rescheduleRows(rows, later(now, backoffMs), { countAttempt: true, error: result.error.message })
  return {}
}

module.exports = {
  processNextBatch,
}
