const { handleQuery, enqueuePosts } = require('./bot')
const { Product, PostedProduct, Schedule, SearchQuery, QueuedPost } = require('./db/models')
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
      expect(output[0].payload).toMatchObject({ priceChanged: true, oldPrice: 500 })
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
      expect(output.map(p => p.payload.oldPrice)).toEqual([500, 500])
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

    // the check is done when the sender batches queued posts for now
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


describe(enqueuePosts, () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await db.sync({ force: true });
  });

  const setup = async () => {
    const query = await SearchQuery.create({ site, query: 'TEST-QUERY-1' })
    const schedule = await Schedule.create({
      webhookURL: 'fake_url:1',
      channelId: 1,
      guildId: 1,
      searchQueryId: query.id
    })
    query.schedules = [schedule];
    return { query, schedule }
  }

  test("Should queue posts without recording them as posted", async () => {
    const { query, schedule } = await setup()
    searchService.search.mockResolvedValueOnce([fakeProduct1])

    const output = [];
    await handleQuery(output)(query)
    await enqueuePosts(output)

    const queued = await QueuedPost.findAll()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ scheduleId: schedule.id, webhookURL: 'fake_url:1', price: fakeProduct1.price, attempts: 0 })
    expect(queued[0].payload.item.siteCode).toBe(fakeProduct1.siteCode)
    expect(await PostedProduct.count()).toBe(0)
  })

  test("Should update a waiting post instead of queueing it twice", async () => {
    const { query } = await setup()

    searchService.search.mockResolvedValueOnce([fakeProduct1])
    const first = [];
    await handleQuery(first)(query)
    await enqueuePosts(first)
    // simulate the sender having tried and backed off
    await QueuedPost.update({ attempts: 2, availableAt: new Date(Date.now() + 60000) }, { where: {} })

    searchService.search.mockResolvedValueOnce([{ ...fakeProduct1, price: 3000 }])
    const second = [];
    await handleQuery(second)(query)
    await enqueuePosts(second)

    const queued = await QueuedPost.findAll()
    expect(queued).toHaveLength(1)
    expect(queued[0].price).toBe(3000)
    expect(queued[0].payload.item.price).toBe(3000)
    // backoff state is kept so a re-found post doesn't skip the queue's waits
    expect(queued[0].attempts).toBe(2)
    expect(queued[0].availableAt.getTime()).toBeGreaterThan(Date.now())
  })

  test("Should handle the same post appearing twice in one run", async () => {
    const { query } = await setup()
    searchService.search.mockResolvedValue([fakeProduct1])

    const output = [];
    await handleQuery(output)(query)
    await handleQuery(output)(query)
    await enqueuePosts(output)

    expect(await QueuedPost.count()).toBe(1)
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
    expect(second[0].payload).toMatchObject({ priceChanged: true, oldPrice: 2000 })
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
