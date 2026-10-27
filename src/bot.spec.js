const { handleQuery, groupPosts, sendPosts } = require('./bot')
const { Product, PostedProduct, Schedule, SearchQuery } = require('./db/models')
const db = require('./db')

// jest.mock('./db/models')
// jest.mock('./db/models')
jest.mock('./services/searchService')

const searchService = require('./services/searchService')
const discordService = require('./services/discordService')

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
        price: fakeProduct1.price,
      })

      const output = [];
      await handleQuery(output)(query)

      expect(output).toHaveLength(0)

    })
  })

  describe("Price changes", () => {
    const setup = async ({ price }) => {
      const query = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })

      const schedule = await Schedule.create({
        webhookURL: 'fake_url:1',
        channelId: 1,
        guildId: 1,
        searchQueryId: query.id
      })
      query.schedules = [schedule];

      const product = await Product.create({
        site: fakeProduct1.site,
        siteProductId: fakeProduct1.siteCode,
        title: fakeProduct1.title,
        price,
      })
      await PostedProduct.create({
        productId: product.id,
        scheduleId: schedule.id,
        price,
      })

      return { query, schedule, product }
    }

    test("Should post and update price if price went up", async () => {
      searchService.search.mockResolvedValueOnce([fakeProduct1])
      const { query, product } = await setup({ price: 500 })

      const output = [];
      await handleQuery(output)(query)

      expect(output).toHaveLength(1)
      expect(output[0].item).toMatchObject({ priceChanged: true, oldPrice: 500 })
      await product.reload()
      expect(product.price).toBe(fakeProduct1.price)
    })

    test("Should not post a small price decrease, and keep comparing against the posted price", async () => {
      searchService.search.mockResolvedValueOnce([fakeProduct1])
      const { query, schedule, product } = await setup({ price: 1500 })

      const output = [];
      await handleQuery(output)(query)

      expect(output).toHaveLength(0)
      const posted = await PostedProduct.findOne({ where: { productId: product.id, scheduleId: schedule.id } })
      expect(posted.price).toBe(1500)
    })

    test("Should post a price change to every channel, even after another query already saw it", async () => {
      searchService.search.mockResolvedValue([fakeProduct1])
      const { query, product } = await setup({ price: 500 })

      const query2 = await SearchQuery.create({ site, query: 'TEST-QUERY-2' })
      const schedule2 = await Schedule.create({
        webhookURL: 'fake_url:2',
        channelId: 2,
        guildId: 2,
        searchQueryId: query2.id
      })
      query2.schedules = [schedule2];
      await PostedProduct.create({ productId: product.id, scheduleId: schedule2.id, price: 500 })

      const output = [];
      await handleQuery(output)(query)
      await handleQuery(output)(query2)

      expect(output).toHaveLength(2)
      expect(output.map(p => p.item.oldPrice)).toEqual([500, 500])
    })

    test("Should create a product once even if search returns it twice", async () => {
      searchService.search.mockResolvedValueOnce([fakeProduct1, fakeProduct1])

      const query = await SearchQuery.create({
        site,
        query: 'TEST-QUERY-1',
      })
      query.schedules = [];

      await handleQuery([])(query)

      expect(await Product.count()).toBe(1)
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


describe(sendPosts, () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.sync({ force: true });
  });

  const setup = async () => {
    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule = await Schedule.create({
      webhookURL: 'fake_url:1',
      channelId: 1,
      guildId: 1,
      searchQueryId: query.id
    })
    query.schedules = [schedule];

    const output = [];
    await handleQuery(output)(query)
    return { query, schedule, output }
  }

  test("Should not record anything before the post is sent", async () => {
    const { output } = await setup()

    expect(output).toHaveLength(1)
    expect(await PostedProduct.count()).toBe(0)
  })

  test("Should record the post once discord accepts it", async () => {
    const { schedule, output } = await setup()
    jest.spyOn(discordService, 'postWebhook').mockResolvedValue(true)

    await sendPosts(groupPosts(output))

    const posted = await PostedProduct.findAll({ raw: true })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ scheduleId: schedule.id, price: fakeProduct1.price })
  })

  test("Should not record a failed post, so the next run tries again", async () => {
    const { query, output } = await setup()
    jest.spyOn(discordService, 'postWebhook').mockResolvedValue(false)

    await sendPosts(groupPosts(output))

    expect(await PostedProduct.count()).toBe(0)

    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const retry = [];
    await handleQuery(retry)(query)
    expect(retry).toHaveLength(1)
  })

  test("Should update the posted price after a price change is posted", async () => {
    const { query, output } = await setup()
    jest.spyOn(discordService, 'postWebhook').mockResolvedValue(true)
    await sendPosts(groupPosts(output))

    searchService.search.mockResolvedValueOnce([{ ...fakeProduct1, price: 3000 }])
    const changed = [];
    await handleQuery(changed)(query)
    expect(changed).toHaveLength(1)
    await sendPosts(groupPosts(changed))

    const posted = await PostedProduct.findOne({ raw: true })
    expect(posted.price).toBe(3000)
  })

  test("Should repost a price change next run if posting it failed", async () => {
    const { query, output } = await setup()
    const postWebhook = jest.spyOn(discordService, 'postWebhook').mockResolvedValue(true)
    await sendPosts(groupPosts(output))

    searchService.search.mockResolvedValue([{ ...fakeProduct1, price: 3000 }])
    const failed = [];
    await handleQuery(failed)(query)
    postWebhook.mockResolvedValue(false)
    await sendPosts(groupPosts(failed))

    const retry = [];
    await handleQuery(retry)(query)
    expect(retry).toHaveLength(1)
    expect(retry[0].item).toMatchObject({ priceChanged: true, oldPrice: fakeProduct1.price })
  })

  test("Should only record the webhooks that succeeded", async () => {
    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const okSchedule = await Schedule.create({ webhookURL: 'ok_url', channelId: 1, guildId: 1, searchQueryId: query.id })
    const badSchedule = await Schedule.create({ webhookURL: 'bad_url', channelId: 2, guildId: 2, searchQueryId: query.id })
    query.schedules = [okSchedule, badSchedule];

    const output = [];
    await handleQuery(output)(query)
    jest.spyOn(discordService, 'postWebhook').mockImplementation(async ({ webhookURL }) => webhookURL === 'ok_url')
    await sendPosts(groupPosts(output))

    const posted = await PostedProduct.findAll({ raw: true })
    expect(posted.map(p => p.scheduleId)).toEqual([okSchedule.id])
  })

  test("Should keep sending other posts if recording one throws", async () => {
    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule1 = await Schedule.create({ webhookURL: 'url_1', channelId: 1, guildId: 1, searchQueryId: query.id })
    const schedule2 = await Schedule.create({ webhookURL: 'url_2', channelId: 2, guildId: 2, searchQueryId: query.id })
    query.schedules = [schedule1, schedule2];

    const output = [];
    await handleQuery(output)(query)
    const postWebhook = jest.spyOn(discordService, 'postWebhook').mockResolvedValue(true)
    jest.spyOn(PostedProduct, 'bulkCreate').mockRejectedValueOnce(new Error('db down'))

    await sendPosts(groupPosts(output))

    expect(postWebhook).toHaveBeenCalledTimes(2)
  })

  test("Should post once but record every schedule that shares a webhook", async () => {
    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule1 = await Schedule.create({ webhookURL: 'shared_url', channelId: 1, guildId: 1, searchQueryId: query.id })
    const schedule2 = await Schedule.create({ webhookURL: 'shared_url', channelId: 1, guildId: 1, searchQueryId: query.id })
    query.schedules = [schedule1, schedule2];

    const output = [];
    await handleQuery(output)(query)
    const postWebhook = jest.spyOn(discordService, 'postWebhook').mockResolvedValue(true)
    await sendPosts(groupPosts(output))

    expect(postWebhook).toHaveBeenCalledTimes(1)
    const posted = await PostedProduct.findAll({ raw: true, order: [['scheduleId', 'ASC']] })
    expect(posted.map(p => p.scheduleId)).toEqual([schedule1.id, schedule2.id])
  })
})

describe("Price edge cases", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.sync({ force: true });
  });

  const setup = async ({ postedPrice, productPrice = postedPrice }) => {
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule = await Schedule.create({ webhookURL: 'fake_url:1', channelId: 1, guildId: 1, searchQueryId: query.id })
    query.schedules = [schedule];
    const product = await Product.create({
      site: fakeProduct1.site,
      siteProductId: fakeProduct1.siteCode,
      title: fakeProduct1.title,
      price: productPrice,
    })
    await PostedProduct.create({ productId: product.id, scheduleId: schedule.id, price: postedPrice })
    return { query }
  }

  test("Should post once several small drops add up to more than 1000", async () => {
    const { query } = await setup({ postedPrice: 2000 })

    searchService.search.mockResolvedValueOnce([{ ...fakeProduct1, price: 1500 }])
    const first = [];
    await handleQuery(first)(query)
    expect(first).toHaveLength(0)

    searchService.search.mockResolvedValueOnce([{ ...fakeProduct1, price: 900 }])
    const second = [];
    await handleQuery(second)(query)
    expect(second).toHaveLength(1)
    expect(second[0].item).toMatchObject({ priceChanged: true, oldPrice: 2000 })
  })

  test("Should fall back to the product's price for rows with no posted price", async () => {
    const { query } = await setup({ postedPrice: null, productPrice: fakeProduct1.price })

    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const output = [];
    await handleQuery(output)(query)

    expect(output).toHaveLength(0)
  })

  test("Should skip items over the price cap", async () => {
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule = await Schedule.create({ webhookURL: 'fake_url:1', channelId: 1, guildId: 1, searchQueryId: query.id })
    query.schedules = [schedule];

    searchService.search.mockResolvedValueOnce([{ ...fakeProduct1, price: 900001 }])
    const output = [];
    await handleQuery(output)(query)

    expect(output).toHaveLength(0)
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

  test('Should keep every schedule\'s record when merging duplicates', () => {
    const posts = [
      { ...makePost({ webhookURL: 'webhook-1' }), records: [{ productId: 1, scheduleId: 1, price: 1000 }] },
      { ...makePost({ webhookURL: 'webhook-1' }), records: [{ productId: 1, scheduleId: 2, price: 1000 }] },
    ];

    const organizedPosts = groupPosts(posts);
    expect(organizedPosts).toHaveLength(1);
    expect(organizedPosts[0].items).toHaveLength(1)
    expect(organizedPosts[0].records.map(r => r.scheduleId)).toEqual([1, 2])
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