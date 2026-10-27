const discordService = require('./discordService')

const rateLimited = (retryAfterSeconds) => Object.assign(new Error('Request failed with status code 429'), {
  response: {
    status: 429,
    headers: { 'retry-after': String(retryAfterSeconds) },
    data: { message: 'You are being rate limited.', retry_after: retryAfterSeconds, global: false },
  },
})

describe('discordService', () => {
  const originalPost = discordService.request.post

  afterEach(() => {
    discordService.request.post = originalPost
  })

  test('Should retry a short rate limit and then succeed', async () => {
    discordService.request.post = jest.fn()
      .mockRejectedValueOnce(rateLimited(0.05))
      .mockResolvedValueOnce({ data: 'ok' })

    await expect(discordService._post('fake_url', {})).resolves.toBe('ok')
    expect(discordService.request.post).toHaveBeenCalledTimes(2)
  })

  describe('postWebhook result', () => {
    const { Schedule } = require('../db/models')
    const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, headers: {}, data: {} },
    })

    afterEach(() => {
      jest.restoreAllMocks()
      delete process.env.ERROR_WEBHOOK
    })

    test('Should resolve true when discord accepts the post', async () => {
      discordService.request.post = jest.fn().mockResolvedValue({ data: {} })

      await expect(discordService.postWebhook({ webhookURL: 'fake_url', embeds: [] })).resolves.toBe(true)
    })

    test('Should resolve false and disable the webhook on a 404', async () => {
      discordService.request.post = jest.fn().mockRejectedValue(httpError(404))
      const disable = jest.spyOn(Schedule, 'disableWebhook').mockResolvedValue()
      jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(discordService.postWebhook({ webhookURL: 'fake_url', embeds: [] })).resolves.toBe(false)
      expect(disable).toHaveBeenCalledWith('fake_url')
    })

    test('Should resolve false on other errors, even when the error report succeeds', async () => {
      process.env.ERROR_WEBHOOK = 'error_url'
      discordService.request.post = jest.fn(async (url) => {
        if (url === 'error_url') return { data: {} }
        throw httpError(500)
      })

      await expect(discordService.postWebhook({ webhookURL: 'fake_url', embeds: [] })).resolves.toBe(false)
      expect(discordService.request.post).toHaveBeenCalledWith('error_url', expect.anything())
    })
  })

  test('Should give up right away instead of sleeping through a long rate limit', async () => {
    discordService.request.post = jest.fn().mockRejectedValue(rateLimited(3600))

    const start = Date.now()
    await expect(discordService._post('fake_url', {})).rejects.toThrow('429')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(discordService.request.post).toHaveBeenCalledTimes(1)
  })
})
