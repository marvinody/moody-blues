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

  test('Should give up right away instead of sleeping through a long rate limit', async () => {
    discordService.request.post = jest.fn().mockRejectedValue(rateLimited(3600))

    const start = Date.now()
    await expect(discordService._post('fake_url', {})).rejects.toThrow('429')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(discordService.request.post).toHaveBeenCalledTimes(1)
  })
})
