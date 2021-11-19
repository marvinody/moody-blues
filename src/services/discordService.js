const axios = require('axios')

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms))


class DiscordService {
  constructor() {
    this.request = axios.create({})

  }

  async postWebhook({ webhookURL, embed }) {
    try {
      const payload = {embeds: [embed], username: "Moody Blues"}
      console.log(JSON.stringify({payload, webhookURL}))
      const {data, status} = await this.request.post(webhookURL, payload)
      console.log({status})
      return data;
    } catch (err) {
      if(err?.response?.data?.retry_after) {
        console.log(`Sleeping for ${err.response.data.retry_after}ms`);
        sleep(err.response.data.retry_after);
        return this.postWebhook({webhookURL, embed})
      } else {
        throw err;
      }
    }
  }
}

module.exports = new DiscordService()
