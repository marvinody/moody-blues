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

  describe('sendWebhook', () => {
    const httpError = (status, { headers = {}, data = {} } = {}) => Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, headers, data },
    })

    test('Should report success with the remaining rate limit', async () => {
      discordService.request.post = jest.fn().mockResolvedValue({
        status: 204,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' },
      })

      await expect(discordService.sendWebhook('fake_url', [])).resolves.toMatchObject({
        ok: true, remaining: 0, resetAfterMs: 1500,
      })
      expect(discordService.request.post).toHaveBeenCalledTimes(1)
    })

    test('Should not retry, and report a webhook-scoped 429', async () => {
      discordService.request.post = jest.fn().mockRejectedValue(httpError(429, {
        headers: { 'retry-after': '3', 'x-ratelimit-scope': 'user', 'x-ratelimit-bucket': 'abc' },
        data: { retry_after: 2.5, global: false },
      }))

      await expect(discordService.sendWebhook('fake_url', [])).resolves.toMatchObject({
        ok: false, status: 429, retryAfterMs: 3000, isGlobal: false,
      })
      expect(discordService.request.post).toHaveBeenCalledTimes(1)
    })

    test('Should treat a global 429 or one without discord headers as global', async () => {
      discordService.request.post = jest.fn()
        .mockRejectedValueOnce(httpError(429, { headers: { 'retry-after': '1800', 'x-ratelimit-global': 'true' }, data: { global: true } }))
        .mockRejectedValueOnce(httpError(429, { headers: { 'retry-after': '1800' }, data: '<html>' }))

      await expect(discordService.sendWebhook('fake_url', [])).resolves.toMatchObject({ isGlobal: true })
      await expect(discordService.sendWebhook('fake_url', [])).resolves.toMatchObject({ isGlobal: true })
    })

    test('Should report other failures with their status', async () => {
      discordService.request.post = jest.fn().mockRejectedValue(httpError(404))

      const result = await discordService.sendWebhook('fake_url', [])
      expect(result).toMatchObject({ ok: false, status: 404, isGlobal: false })
      expect(result.error.message).toContain('404')
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
