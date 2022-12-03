const axios = require('axios')
const memoize = require("memoizee");

const MAX_LENGTH = 1500

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
      case 'LASHINBANG':
        return this.lashinbang({ query })
      case 'MANDARAKE':
        return this.mandarake({ query })
      case 'RAKUTEN':
        return this.rakuten({ query })
      default:
        return Promise.reject(new Error(`No resolver for search: "${service}"`));
    }
  }

  async lashinbang({ query }) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      const { data } = await this.request.get('/lashinbang', {
        params: {
          page,
          query,
        }
      });

      // only push the sfw stuff
      allItems.push(...data.items.filter(item => !item.nsfw))
      hasMore = data.hasMore && allItems.length <= MAX_LENGTH
    }
    return allItems;
  }

  async yaj({ query }) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      const { data } = await this.request.get('/yaj', {
        params: {
          page,
          query,
        }
      });
      allItems.push(...data.items)
      hasMore = data.hasMore && allItems.length <= MAX_LENGTH
    }
    return allItems;
  }

  async rakuten({ query }) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      const { data } = await this.request.get('/rakuten', {
        params: {
          page,
          query,
        }
      });
      allItems.push(...data.items)
      hasMore = data.hasMore && allItems.length <= MAX_LENGTH
    }
    return allItems;
  }
 
  async mandarake({ query }) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      const { data } = await this.request.get('/mandarake', {
        params: {
          page,
          query,
        }
      });
      allItems.push(...data.items)
      hasMore = data.hasMore && allItems.length <= MAX_LENGTH
    }
    return allItems;
  }
}

module.exports = new SearchService()
