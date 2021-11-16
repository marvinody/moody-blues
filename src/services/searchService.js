const axios = require('axios')


class SearchService {
  constructor() {
    this.request = axios.create({
      baseURL: process.env.SEARCH_API
    })

  }

  async yaj({ page, query }) {
    const {data } = await this.request.get('/yaj', {
      params: {
        page,
        query,
      }
    });
    return data;
  }
}

module.exports = new SearchService()
