const axios = require('axios')
const memoize = require("memoizee");
const log = require('../util/logger');
const discordService = require('./discordService');
const searchSettings = require('../../config/search');

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(), ms))

class SearchService {
  constructor() {
    this.request = axios.create({
      baseURL: process.env.SEARCH_API,
      headers: {
        'api-key': process.env.API_KEY
      }
    })

    this.search = memoize(this.search.bind(this), { promise: true });

    // tail of each site's request queue, so requests to one site never overlap
    this.siteQueues = new Map();

  }

  async search(service, query) {
    switch (service) {
      case 'YAJ':
        return this._searchHelper({ query, site: 'yaj', service })
      case 'MERCARI':
        return this._searchHelper({ query, site: 'mercari', service })
      case 'LASHINBANG':
        return this._searchHelper({ query, site: 'lashinbang', service })
        case 'RAKUTEN':
          return this._searchHelper({ query, site: 'rakuten', service })
      case 'MANDARAKE':
        return this._searchHelper({ query, site: 'mandarake', service })
      case 'SURUGAYA':
        return this._searchHelper({ query, site: 'surugaya', service })
      default:
        return Promise.reject(new Error(`No resolver for search: "${service}"`));
    }
  }

  // runs fn once every earlier request to this site has finished and the gap has passed
  _queueForSite(site, fn) {
    const previous = this.siteQueues.get(site) ?? Promise.resolve()
    const run = previous.then(fn)

    const gapMs = searchSettings.SEARCH_DELAY_BETWEEN_REQUESTS_PER_SITE_MS
      + Math.random() * searchSettings.SEARCH_RANDOM_EXTRA_DELAY_MAX_MS
    // wait out the gap even if this request failed
    this.siteQueues.set(site, run.catch(() => {}).then(() => sleep(gapMs)))

    return run
  }

  _maxPagesFor(service) {
    return searchSettings.SEARCH_MAX_PAGES_PER_QUERY_BY_SITE[service]
      ?? searchSettings.SEARCH_MAX_PAGES_PER_QUERY
  }

  async _searchHelper({query, site, service}) {
    const maxPages = this._maxPagesFor(service);
    let page = 0;
    let allItems = [];
    let hasMore = true;
    try {
      while (hasMore) {
        page += 1;
        const { data } = await this._queueForSite(site, () => this.request.get(`/${site}`, {
          params: {
            page,
            query,
          }
        }));
        
        // only push the sfw stuff
        allItems.push(...data.items.filter(item => !item.nsfw))
        hasMore = data.hasMore
          && page < maxPages
          && allItems.length <= searchSettings.SEARCH_MAX_ITEMS_PER_QUERY
      }
    } catch (err) {
      log.error(err)
      await discordService.postError(err)
    }
    return allItems;
  }

}

module.exports = new SearchService()
