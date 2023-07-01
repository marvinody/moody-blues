const { handleQuery, groupPosts } = require('./bot')
const { Product, PostedProduct, Schedule, SearchQuery } = require('./db/models')
const db = require('./db')

// jest.mock('./db/models')
// jest.mock('./db/models')
jest.mock('./services/searchService')

const searchService = require('./services/searchService')

const site = 'TEST-SITE';
const query1 = 'TEST-QUERY-1';
const query2 = 'TEST-QUERY-2';
const desc = 'TEST-DESC';

const schedule1 = {
  id: 1,
  webhookURL: 'FAKE_URL_1'
}

const schedule2 = {
  id: 2,
  webhookURL: 'FAKE_URL_2'
}

const fakeProduct1 = {
  site,
  siteCode: `${site}-1`,
  price: 1000,
  title: "FAKE_TITLE",
  isdirty: true
}

describe(handleQuery, () => {

  beforeEach(async () => {
    jest.resetAllMocks();

    await db.sync({ force: true });
  });

  describe("Simple one scheudle lookup", () => {
    test("Should add a post if product hasn't been posted before", async () => {
      searchService.search.mockResolvedValueOnce([fakeProduct1])

      const query = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })

      const schedule = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query1.id
      })

      query.schedules = [schedule];

      const output = [];
      await handleQuery(output)(query)

      expect(output).toHaveLength(1)

    })

    test("Should not add a post if product has been posted before", async () => {
      searchService.search.mockResolvedValueOnce([fakeProduct1])

      const query = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })

      const schedule = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query1.id
      })
      query.schedules = [schedule];

      const product = await Product.create({
        site: fakeProduct1.site,
        siteProductId: fakeProduct1.siteCode,
        title: fakeProduct1.title,
        price: fakeProduct1.price,
      })
      await PostedProduct.create({
        productId: product.id,
        scheduleId: schedule.id,
      })

      const output = [];
      await handleQuery(output)(query)

      expect(output).toHaveLength(0)

    })
  })

  describe("Reports correctly even if items are found on different queries", () => {
    test("Should create 2 posts if 2 schedules have 2 queries with same item (new)", async () => {
      searchService.search.mockResolvedValue([fakeProduct1]);

      const query1 = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })

      const query2 = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-2',
      })

      const schedule1 = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query1.id
      })

      const schedule2 = await Schedule.create({
        webhookURL: 'fake_url:2',
        channelId: 2,
        guildId: 2,
        searchQueryId: query2.id
      })

      const output = [];

      query1.schedules = [schedule1];
      query2.schedules = [schedule2];

      await handleQuery(output)(query1);
      await handleQuery(output)(query2);

      expect(output).toHaveLength(2)

    })

    // the check is done in groupPosts for now
    test.skip("Should create 1 posts if 2 queries return with same item (dedupe)", async () => {
      searchService.search.mockResolvedValue([fakeProduct1]);

      const query1 = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })

      const query2 = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-2',
      })

      const schedule1 = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query1.id
      })

      const schedule2 = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query2.id
      })

      const output = [];

      query1.schedules = [schedule1];
      query2.schedules = [schedule2];

      await handleQuery(output)(query1);
      await handleQuery(output)(query2);

      expect(output).toHaveLength(1)

    })
  })
})


describe(groupPosts, () => {

  const makePost = ({
    siteCode = 'TEST-SITE-1',
    webhookURL = 'fake_url:1',
  } = {}) => ({
    "item": {
      "item": {
        "isdirty": true,
        "price": 1000,
        "site": "TEST-SITE",
        "siteCode": siteCode,
        "title": "FAKE_TITLE"
      },
      "oldPrice": 1000,
      "priceChanged": false
    },
    "webhookURL": webhookURL,
  })

  test('Should group by webhookURLs', () => {
    const posts = [
      makePost({ webhookURL: 'webhook-1' }),
      makePost({ webhookURL: 'webhook-2' }),
      makePost({ webhookURL: 'webhook-3' }),
    ];

    const organizedPosts = groupPosts(posts);
    expect(organizedPosts).toHaveLength(3);
  })

  test('Should remove duplicate items on same webhookURL', () => {
    const posts = [
      makePost({ webhookURL: 'webhook-1' }),
      makePost({ webhookURL: 'webhook-2' }),
      makePost({ webhookURL: 'webhook-1' }),
      makePost({ webhookURL: 'webhook-2' }),
    ];

    const organizedPosts = groupPosts(posts);
    expect(organizedPosts).toHaveLength(2);
    expect(organizedPosts[0].items).toHaveLength(1)
    expect(organizedPosts[1].items).toHaveLength(1)
  })
})