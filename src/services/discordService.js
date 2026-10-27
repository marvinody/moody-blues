const axios = require('axios')
const { Schedule } = require('../db/models')
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

  // resolves true if discord accepted the post, false if it failed (already reported)
  async postWebhook({ webhookURL, embeds }) {
    try {
      const payload = {
        embeds,
        username: "Moody Blues",
        avatar_url: "https://i.imgur.com/egvX9g2.png",
      }
      await this._post(webhookURL, payload)
      return true
    } catch (err) {
      if (err?.response?.status === 404) {

        await Schedule.disableWebhook(webhookURL)
        if(process.env.ERROR_WEBHOOK) {
          await this.postDisablingWebhook(err, webhookURL)
        } else {
          console.error(`Disabling webhook ${webhookURL}`)
        }

      } else {
        if (process.env.ERROR_WEBHOOK) {
          await this.postGenericErrorWebhook(err, webhookURL);
        } else {
          console.error(err)
        }
      }
      return false
    }
  }
}

module.exports = new DiscordService()
