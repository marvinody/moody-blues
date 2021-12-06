const axios = require('axios')
const memoize = require("memoizee");

class SearchService {
  constructor() {
    this.request = axios.create({
      baseURL: process.env.SEARCH_API,
      headers: {
        'api-key': process.env.API_KEY
      }
    })

    this.search = memoize(this.search.bind(this), { promise: true });

  }

  async search(service, query) {
    switch (service) {
      case 'YAJ':
        return this.yaj({ query })
      default:
        return Promise.reject("No resolver for search");
    }
  }

  async yaj({ query }) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      console.log({ page })
      const { data } = await this.request.get('/yaj', {
        params: {
          page,
          query,
        }
      });
      allItems.push(...data.items)
      hasMore = data.hasMore
    }
    return allItems;
  }
}

module.exports = new SearchService()
