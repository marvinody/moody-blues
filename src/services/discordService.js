const axios = require('axios')

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms))


class DiscordService {
  constructor() {
    this.request = axios.create({})

  }

  async postWebhook({ webhookURL, embed }) {
    try {
      const payload = {
        embeds: [embed],
        username: "Moody Blues",
        avatar_url: "https://i.imgur.com/egvX9g2.png",
      }
      const { data } = await this.request.post(webhookURL, payload)
      return data;
    } catch (err) {
      if (err?.response?.data?.retry_after) {
        await sleep(err.response.data.retry_after);
        return this.postWebhook({ webhookURL, embed })
      } else {
        throw err;
      }
    }
  }
}

module.exports = new DiscordService()
