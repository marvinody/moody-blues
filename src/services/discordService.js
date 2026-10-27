const axios = require('axios')
const log = require('../util/logger')

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms))

const getId = webhook => webhook.slice('https://discord.com/api/webhooks/'.length).split('/')[0]

const MAX_RATE_LIMIT_RETRIES = 5
// longer waits than this mean we're banned for a while; drop the post instead of stalling the run
const MAX_RATE_LIMIT_WAIT_MS = 60 * 1000
const DISCORD_REQUEST_TIMEOUT_MS = 30 * 1000

// returns ms to wait, or undefined if this isn't a rate limit
const getRetryDelay = (err) => {
  if (err?.response?.status !== 429) {
    return undefined
  }
  // Retry-After header is always seconds; fall back to the body (seconds on current API versions)
  const seconds = Number(err.response.headers?.['retry-after'] ?? err.response.data?.retry_after)
  return Number.isFinite(seconds) ? seconds * 1000 : 1000
}

const numberHeader = (headers, name) => {
  const value = Number(headers?.[name])
  return headers?.[name] !== undefined && Number.isFinite(value) ? value : undefined
}

// what discord's headers say about this webhook's limit, after a success or a 429
const rateLimitInfo = (response) => {
  const resetAfterSeconds = numberHeader(response?.headers, 'x-ratelimit-reset-after')
  return {
    remaining: numberHeader(response?.headers, 'x-ratelimit-remaining'),
    resetAfterMs: resetAfterSeconds === undefined ? undefined : resetAfterSeconds * 1000,
  }
}

// a 429 that isn't scoped to one webhook (or has no discord headers at all, like a
// cloudflare block) means every request is blocked, not just this webhook
const isGlobalRateLimit = (response) => {
  const headers = response?.headers ?? {}
  return response?.data?.global === true
    || headers['x-ratelimit-global'] === 'true'
    || headers['x-ratelimit-scope'] === 'global'
    || (headers['x-ratelimit-bucket'] === undefined && headers['x-ratelimit-scope'] === undefined)
}

class DiscordService {
  constructor() {
    this.request = axios.create({ timeout: DISCORD_REQUEST_TIMEOUT_MS })

  }

  async _post(webhookURL, payload) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await this.request.post(webhookURL, payload)
        return data
      } catch (err) {
        const delay = getRetryDelay(err)
        if (delay === undefined || attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw err
        }
        if (delay > MAX_RATE_LIMIT_WAIT_MS) {
          log.warn(`Discord asked us to wait ${Math.round(delay / 1000)}s, giving up on this post`)
          throw err
        }
        log.warn(`Rate limited by Discord, waiting ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`)
        await sleep(delay)
      }
    }
  }

  // error reporting must never throw, or a failed report (e.g. a 429) takes the whole run down
  async _postToErrorWebhook(content) {
    if (!process.env.ERROR_WEBHOOK) {
      return
    }
    try {
      await this._post(process.env.ERROR_WEBHOOK, {
        username: "Moody Blues",
        avatar_url: "https://i.imgur.com/egvX9g2.png",
        // discord rejects content over 2000 chars
        content: content.slice(0, 2000),
      })
    } catch (err) {
      log.error(`Failed to post to error webhook: ${err.message}`)
    }
  }

  async postError(err) {
    await this._postToErrorWebhook(`Error: ${err.message}, \`\`\` ${err.stack} \`\`\``)
  }

  async postDisablingWebhook(err, webhookToDisable) {
    const id = getId(webhookToDisable)
    await this._postToErrorWebhook(`Expiring webhook for 404: ${id}\n${err.message}`)
  }

  async postGenericErrorWebhook(err, webhook) {
    const id = getId(webhook)
    await this._postToErrorWebhook(`Error for webhook: ${id}\n${err.toString()}`)
  }

  webhookId(webhookURL) {
    return getId(webhookURL)
  }

  // sends one webhook message with no retries; the sender service decides what to do with the result
  async sendWebhook(webhookURL, embeds) {
    try {
      const response = await this.request.post(webhookURL, {
        embeds,
        username: "Moody Blues",
        avatar_url: "https://i.imgur.com/egvX9g2.png",
      })
      return { ok: true, status: response.status, ...rateLimitInfo(response) }
    } catch (err) {
      const status = err?.response?.status
      return {
        ok: false,
        status,
        error: err,
        retryAfterMs: getRetryDelay(err),
        isGlobal: status === 429 && isGlobalRateLimit(err.response),
        ...rateLimitInfo(err?.response),
      }
    }
  }
}

module.exports = new DiscordService()
