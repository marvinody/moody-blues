const axios = require('axios')
const { Schedule } = require('../db/models')

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms))

const getId = webhook => webhook.slice('https://discord.com/api/webhooks/'.length).split('/')[0]

class DiscordService {
  constructor() {
    this.request = axios.create({})

  }

  async postDisablingWebhook(err, webhookToDisable) {
    const id = getId(webhookToDisable)
    await this.request.post(process.env.ERROR_WEBHOOK, {
      username: "Moody Blues",
      avatar_url: "https://i.imgur.com/egvX9g2.png",
      content: `Expiring webhook for 404: ${id}\n${err.message}`
    })
  }

  async postGenericErrorWebhook(err, webhook) {
    const id = getId(webhook)
    await this.request.post(process.env.ERROR_WEBHOOK, {
      username: "Moody Blues",
      avatar_url: "https://i.imgur.com/egvX9g2.png",
      content: `Error for webhook: ${id}\n${err.toString()}`
    })
  }

  async postWebhook({ webhookURL, embeds }) {
    try {
      const payload = {
        embeds,
        username: "Moody Blues",
        avatar_url: "https://i.imgur.com/egvX9g2.png",
      }
      const { data } = await this.request.post(webhookURL, payload)
      return data;
    } catch (err) {
      if (err?.response?.data?.retry_after) {

        await sleep(err.response.data.retry_after);
        return this.postWebhook({ webhookURL, embeds })

      } else if (err?.response?.status === 404) {

        await Schedule.disableWebhook(webhookURL)
        if(process.env.ERROR_WEBHOOK) {
          return this.postDisablingWebhook(err, webhookURL)
        }
        console.error(`Disabling webhook ${webhookURL}`)

      } else {
        if (process.env.ERROR_WEBHOOK) {
          return this.postGenericErrorWebhook(err);
        } else {
          console.error(err)
        }
      }
    }
  }
}

module.exports = new DiscordService()
