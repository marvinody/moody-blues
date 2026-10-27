const db = require('../db')
const { Product, PostedProduct, Schedule, SearchQuery, QueuedPost } = require('../db/models')
const discordService = require('../services/discordService')
const settings = require('../../config/sender')
const queue = require('./queue')
const { processNextBatch } = require('./sender')

const site = 'TEST-SITE'
const NOW = new Date('2026-10-28T00:00:00Z')
const later = (ms) => new Date(NOW.getTime() + ms)

let searchQuery
let productCount = 0

const makeSchedule = (webhookURL, enabled = true) => Schedule.create({
  webhookURL,
  enabled,
  channelId: 1,
  guildId: 1,
  searchQueryId: searchQuery.id,
})

const makeProduct = (price = 1000) => {
  productCount += 1
  return Product.create({ site, siteProductId: `${site}-${productCount}`, title: 'FAKE_TITLE', price })
}

const enqueue = (product, schedule, { price = product.price, createdAt = NOW, ...rest } = {}) => QueuedPost.create({
  productId: product.id,
  scheduleId: schedule.id,
  webhookURL: schedule.webhookURL,
  price,
  payload: {
    item: { site, siteCode: product.siteProductId, title: product.title, price, url: 'https://example.com', imageURL: '' },
    priceChanged: false,
    oldPrice: price,
  },
  availableAt: NOW,
  createdAt,
  ...rest,
})

const sent = (overrides = {}) => ({ ok: true, status: 204, ...overrides })
const failed = (status, overrides = {}) => ({ ok: false, status, error: new Error(`status ${status}`), ...overrides })

describe('sender', () => {
  let sendWebhook

  beforeEach(async () => {
    jest.restoreAllMocks()
    await db.sync({ force: true })
    searchQuery = await SearchQuery.create({ site, query: 'TEST-QUERY' })
    sendWebhook = jest.spyOn(discordService, 'sendWebhook').mockResolvedValue(sent())
    jest.spyOn(discordService, 'postDisablingWebhook').mockResolvedValue()
    jest.spyOn(discordService, 'postGenericErrorWebhook').mockResolvedValue()
  })

  test('Should be idle when nothing is queued', async () => {
    await expect(processNextBatch({ now: NOW })).resolves.toEqual({ idle: true })
    expect(sendWebhook).not.toHaveBeenCalled()
  })

  test('Should send, record as posted, and remove from the queue', async () => {
    const schedule = await makeSchedule('url_1')
    const product = await makeProduct(1200)
    await enqueue(product, schedule)

    await processNextBatch({ now: NOW })

    expect(sendWebhook).toHaveBeenCalledTimes(1)
    const [webhookURL, embeds] = sendWebhook.mock.calls[0]
    expect(webhookURL).toBe('url_1')
    expect(embeds).toHaveLength(1)
    expect(await QueuedPost.count()).toBe(0)
    const posted = await PostedProduct.findAll({ raw: true })
    expect(posted).toEqual([expect.objectContaining({ productId: product.id, scheduleId: schedule.id, price: 1200 })])
  })

  test('Should send at most SENDER_MAX_EMBEDS_PER_POST items per message, one webhook at a time', async () => {
    const schedule1 = await makeSchedule('url_1')
    const schedule2 = await makeSchedule('url_2')
    for (let i = 0; i < settings.SENDER_MAX_EMBEDS_PER_POST + 2; i++) {
      await enqueue(await makeProduct(), schedule1, { createdAt: later(i) })
    }
    await enqueue(await makeProduct(), schedule2, { createdAt: later(100) })

    await processNextBatch({ now: NOW })

    const [webhookURL, embeds] = sendWebhook.mock.calls[0]
    expect(webhookURL).toBe('url_1')
    expect(embeds).toHaveLength(settings.SENDER_MAX_EMBEDS_PER_POST)
    expect(await QueuedPost.count({ where: { webhookURL: 'url_1' } })).toBe(2)
    expect(await QueuedPost.count({ where: { webhookURL: 'url_2' } })).toBe(1)
  })

  test('Should post an item once to a shared webhook but record every schedule', async () => {
    const schedule1 = await makeSchedule('shared_url')
    const schedule2 = await makeSchedule('shared_url')
    const product = await makeProduct()
    await enqueue(product, schedule1)
    await enqueue(product, schedule2)

    await processNextBatch({ now: NOW })

    expect(sendWebhook.mock.calls[0][1]).toHaveLength(1)
    const posted = await PostedProduct.findAll({ raw: true, order: [['scheduleId', 'ASC']] })
    expect(posted.map(p => p.scheduleId)).toEqual([schedule1.id, schedule2.id])
  })

  test("Should hold a webhook's posts when discord says it has no requests left", async () => {
    sendWebhook.mockResolvedValue(sent({ remaining: 0, resetAfterMs: 5000 }))
    const schedule = await makeSchedule('url_1')
    await enqueue(await makeProduct(), schedule, { createdAt: NOW })
    await enqueue(await makeProduct(), schedule, { createdAt: later(1) })
    settings.SENDER_MAX_EMBEDS_PER_POST = 1

    try {
      await processNextBatch({ now: NOW })
    } finally {
      settings.SENDER_MAX_EMBEDS_PER_POST = 10
    }

    const [left] = await QueuedPost.findAll()
    expect(left.availableAt.getTime()).toBe(later(5000).getTime())
    await expect(processNextBatch({ now: later(1000) })).resolves.toEqual({ idle: true })
  })

  test('Should hold only that webhook on a webhook-scoped 429, without counting an attempt', async () => {
    const schedule1 = await makeSchedule('url_1')
    const schedule2 = await makeSchedule('url_2')
    await enqueue(await makeProduct(), schedule1, { createdAt: NOW })
    await enqueue(await makeProduct(), schedule2, { createdAt: later(1) })
    sendWebhook.mockResolvedValueOnce(failed(429, { retryAfterMs: 30000, isGlobal: false }))

    await expect(processNextBatch({ now: NOW })).resolves.toEqual({})

    const held = await QueuedPost.findOne({ where: { webhookURL: 'url_1' } })
    expect(held.attempts).toBe(0)
    expect(held.availableAt.getTime()).toBe(later(30000).getTime())

    await processNextBatch({ now: NOW })
    expect(sendWebhook.mock.calls[1][0]).toBe('url_2')
  })

  test('Should pause all sending on a global 429, for at least a minute', async () => {
    const schedule = await makeSchedule('url_1')
    await enqueue(await makeProduct(), schedule)
    sendWebhook.mockResolvedValueOnce(failed(429, { retryAfterMs: 1000, isGlobal: true }))

    const outcome = await processNextBatch({ now: NOW })

    expect(outcome.pauseAllMs).toBe(60 * 1000)
    expect(await QueuedPost.count()).toBe(1)
    expect(await PostedProduct.count()).toBe(0)
  })

  test('Should disable a deleted webhook and drop its posts', async () => {
    const schedule = await makeSchedule('gone_url')
    await enqueue(await makeProduct(), schedule)
    sendWebhook.mockResolvedValueOnce(failed(404))

    await processNextBatch({ now: NOW })

    await schedule.reload()
    expect(schedule.enabled).toBe(false)
    expect(await QueuedPost.count()).toBe(0)
    expect(await PostedProduct.count()).toBe(0)
    expect(discordService.postDisablingWebhook).toHaveBeenCalled()
  })

  test('Should retry other failures with growing backoff, then give up', async () => {
    const schedule = await makeSchedule('url_1')
    await enqueue(await makeProduct(), schedule)
    sendWebhook.mockResolvedValue(failed(500))

    await processNextBatch({ now: NOW })
    let row = await QueuedPost.findOne()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe('status 500')
    expect(row.availableAt.getTime()).toBe(later(settings.SENDER_RETRY_BACKOFF_BASE_MS).getTime())

    await processNextBatch({ now: row.availableAt })
    const secondTry = row.availableAt
    row = await QueuedPost.findOne()
    expect(row.attempts).toBe(2)
    expect(row.availableAt.getTime() - secondTry.getTime()).toBe(settings.SENDER_RETRY_BACKOFF_BASE_MS * 2)

    for (let attempt = 3; attempt <= settings.SENDER_MAX_ATTEMPTS; attempt++) {
      row = await QueuedPost.findOne()
      await processNextBatch({ now: row.availableAt })
    }
    expect(await QueuedPost.count()).toBe(0)
    expect(await PostedProduct.count()).toBe(0)
    expect(discordService.postGenericErrorWebhook).toHaveBeenCalledTimes(1)
  })

  test('Should keep a post whose price was updated while it was being sent', async () => {
    const schedule = await makeSchedule('url_1')
    const product = await makeProduct(1000)
    await enqueue(product, schedule)
    sendWebhook.mockImplementationOnce(async () => {
      // the bot re-queues the item at a new price mid-send
      await QueuedPost.update({ price: 3000 }, { where: { productId: product.id } })
      return sent()
    })

    await processNextBatch({ now: NOW })

    const posted = await PostedProduct.findOne({ raw: true })
    expect(posted.price).toBe(1000)
    const [row] = await QueuedPost.findAll()
    expect(row.price).toBe(3000)
    expect(row.availableAt.getTime()).toBe(NOW.getTime())
  })

  test('Should not claim posts again while their lease is active', async () => {
    const schedule = await makeSchedule('url_1')
    await enqueue(await makeProduct(), schedule)

    const claimed = await queue.claimNextBatch({ now: NOW, leaseMs: 60000, maxEmbeds: 10 })
    expect(claimed.rows).toHaveLength(1)

    await expect(queue.claimNextBatch({ now: later(1000), leaseMs: 60000, maxEmbeds: 10 })).resolves.toBeNull()
    const reclaimed = await queue.claimNextBatch({ now: later(60000), leaseMs: 60000, maxEmbeds: 10 })
    expect(reclaimed.rows).toHaveLength(1)
  })

  test('Should skip and clean up posts for disabled schedules, and drop expired ones', async () => {
    const disabled = await makeSchedule('off_url', false)
    const enabled = await makeSchedule('on_url')
    await enqueue(await makeProduct(), disabled)
    await enqueue(await makeProduct(), enabled, { createdAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000) })
    await enqueue(await makeProduct(), enabled, { createdAt: NOW })

    const claimed = await queue.claimNextBatch({ now: NOW, leaseMs: 1, maxEmbeds: 10 })
    expect(claimed.webhookURL).toBe('on_url')

    await expect(queue.cleanupQueue({ now: NOW, maxAgeHours: 72 })).resolves.toEqual({ tooOld: 1, disabled: 1 })
    expect(await QueuedPost.count()).toBe(1)
  })
})
