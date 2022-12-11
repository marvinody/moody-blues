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
        return this._searchHelper({ query, site: 'yaj' })
      case 'MERCARI':
        return this._searchHelper({ query, site: 'mercari' })
      case 'LASHINBANG':
        return this._searchHelper({ query, site: 'lashinbang' })
        case 'RAKUTEN':
          return this._searchHelper({ query, site: 'rakuten' })
      case 'MANDARAKE':
        return this._searchHelper({ query, site: 'mandarake' })
      case 'SURUGAYA':
        return this._searchHelper({ query, site: 'surugaya' })
      default:
        return Promise.reject(new Error(`No resolver for search: "${service}"`));
    }
  }

  async _searchHelper({query, site}) {
    let page = 0;
    let allItems = [];
    let hasMore = true;
    while (hasMore) {
      page += 1;
      const { data } = await this.request.get(`/${site}`, {
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

}

module.exports = new SearchService()
