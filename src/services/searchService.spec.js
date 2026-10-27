const searchSettings = require('../../config/search')
const searchService = require('./searchService')

const DELAY_MS = 50

describe('searchService', () => {
  let calls

  beforeEach(() => {
    searchSettings.SEARCH_MAX_PAGES_PER_QUERY = 3
    searchSettings.SEARCH_MAX_PAGES_PER_QUERY_BY_SITE = { YAJ: 2 }
    searchSettings.SEARCH_DELAY_BETWEEN_REQUESTS_PER_SITE_MS = DELAY_MS
    searchSettings.SEARCH_RANDOM_EXTRA_DELAY_MAX_MS = 0
    searchService.search.clear()
    searchService.siteQueues.clear()

    calls = []
    searchService.request.get = jest.fn(async (path, { params }) => {
      const call = { path, page: params.page, query: params.query, start: Date.now() }
      calls.push(call)
      await new Promise(resolve => setTimeout(resolve, 10))
      call.end = Date.now()
      return { data: { items: [{ siteCode: `${params.query}-${params.page}` }], hasMore: true } }
    })
  })

  test('Should use the per-site page cap when one is set', async () => {
    const items = await searchService.search('YAJ', 'q1')

    expect(calls.map(c => c.page)).toEqual([1, 2])
    expect(items).toHaveLength(2)
  })

  test('Should fall back to SEARCH_MAX_PAGES_PER_QUERY for other sites', async () => {
    const items = await searchService.search('MERCARI', 'q1')

    expect(calls.map(c => c.page)).toEqual([1, 2, 3])
    expect(items).toHaveLength(3)
  })

  test('Should not overlap requests to the same site and wait between them', async () => {
    await Promise.all([
      searchService.search('YAJ', 'q1'),
      searchService.search('YAJ', 'q2'),
    ])

    expect(calls).toHaveLength(4) // 2 YAJ pages per query
    for (let i = 1; i < calls.length; i++) {
      // allow a few ms of timer slop
      expect(calls[i].start - calls[i - 1].end).toBeGreaterThanOrEqual(DELAY_MS - 5)
    }
  })

  test('Should let different sites run at the same time', async () => {
    await Promise.all([
      searchService.search('YAJ', 'q1'),
      searchService.search('MERCARI', 'q1'),
    ])

    const firstYaj = calls.find(c => c.path === '/yaj')
    const firstMercari = calls.find(c => c.path === '/mercari')
    expect(Math.abs(firstYaj.start - firstMercari.start)).toBeLessThan(DELAY_MS)
  })
})
