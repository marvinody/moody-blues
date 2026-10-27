require('dotenv').config()
const db = require('./db')
const { Schedule, SearchQuery, PostedProduct, Product, QueuedPost } = require('./db/models')
const _ = require('lodash')
const searchService = require('./services/searchService')
const discordService = require('./services/discordService')
const asyncPool = require('tiny-async-pool')
const log = require('./util/logger')
const { QUEUE_NOTIFY_CHANNEL } = require('./sender/queue')

// adds posts to the queue for the sender service; a post that's still waiting is updated
// in place (latest price wins) instead of being queued twice
const enqueuePosts = async (posts) => {
  const rows = _.uniqBy(posts, ({ productId, scheduleId }) => postedKey(productId, scheduleId))
  for (const chunk of _.chunk(rows, DB_CHUNK_SIZE)) {
    await QueuedPost.bulkCreate(chunk, { updateOnDuplicate: ['webhookURL', 'payload', 'price', 'updatedAt'] })
  }

  if (rows.length > 0 && db.getDialect() === 'postgres') {
    // wake the sender right away instead of waiting for its next poll
    await db.query(`SELECT pg_notify('${QUEUE_NOTIFY_CHANNEL}', '')`)
  }
}

async function main() {

  const postsToMake = [];

  const queries = await SearchQuery.findAll({
    include: [
      {
        model: Schedule,
        where: {
          enabled: true
        }
      }
    ]
  })


  try {
    for await (const _ of asyncPool(4, queries, handleQuery(postsToMake))) {
      // no op, don't need return
    }

  } catch (err) {
    log.error(err);
    await discordService.postError(err)

  } finally {
    log.info(`Queueing ${postsToMake.length} posts`)
    await enqueuePosts(postsToMake)
  }

}



const handleQuery = (postsToMake) => async (queryEntry) => {
  const { site, query, schedules, desc } = queryEntry

  // make site dynamic and fetch all results instead of paging through
  // probably abstract to the service to let it do that
  const childLog = log.child({
    site,
    desc,
    query,
  })
  childLog.info('Starting search')
  const searchResults = await searchService.search(site, query)

  // anything bigger crashes the bot because DB doesn't like and I'm not fixing because it's dumb...
  // also dedupe so paging overlaps don't create the same product twice
  const items = _.uniqBy(
    searchResults.filter(item => item.price <= 2 ** 31),
    item => productKey(item.site, item.siteCode),
  )

  childLog.info(`handling ${items.length} item(s)`)

  // look up every product for this query in a few big queries instead of one per item
  const productsByKey = await findOrCreateProducts(items)

  const itemsToPost = items
    .filter(item => item.price <= 900000)
    .map(item => ({ item, product: productsByKey.get(productKey(item.site, item.siteCode)) }))

  // what each schedule was last shown, so price changes are judged per channel
  const lastPostedPrices = await findLastPostedPrices(
    itemsToPost.map(({ product }) => product.id),
    schedules.map(({ id }) => id),
  )

  for (const { item, product } of itemsToPost) {
    for (const { id, webhookURL } of schedules) {
      const key = postedKey(product.id, id)
      const neverPosted = !lastPostedPrices.has(key)
      // rows from before prices were tracked per channel fall back to the product's price
      const oldPrice = lastPostedPrices.get(key) ?? product.price
      const priceChanged = !neverPosted && oldPrice !== item.price

      // if price went up, price diff < 0
      // if price went down, price diff > 0
      const priceDifference = oldPrice - item.price
      const priceDecreased = priceDifference > 0
      // if it's a small change, we don't want to broadcast (and keep comparing against the posted price)
      if (priceChanged && priceDecreased && priceDifference <= 1000) {
        continue
      }

      if (neverPosted || priceChanged) {
        // postedProducts is only written once the sender gets this through to discord,
        // so anything unsent is found and queued again next run
        postsToMake.push({
          productId: product.id,
          scheduleId: id,
          webhookURL,
          price: item.price,
          payload: {
            item,
            priceChanged,
            oldPrice,
          },
        })
      }
    }
  }

  // keep the product's latest seen price current; posting decisions use the per-channel price above
  const productsToUpdate = itemsToPost.filter(({ item, product }) => product.price !== item.price)
  for await (const _ of asyncPool(4, productsToUpdate, ({ item, product }) => product.update({
    price: item.price,
  }))) {
  }
}

// keeps IN (...) lists under sqlite's bound parameter limit and postgres query sizes sane
const DB_CHUNK_SIZE = 500

const productKey = (site, siteProductId) => `${site}\u0000${siteProductId}`
const postedKey = (productId, scheduleId) => `${productId}:${scheduleId}`

const findProducts = async (items, productsByKey) => {
  const sites = _.uniq(items.map(item => item.site))

  for (const chunk of _.chunk(items, DB_CHUNK_SIZE)) {
    const existing = await Product.findAll({
      where: {
        site: sites,
        siteProductId: chunk.map(item => item.siteCode),
      },
    })
    for (const product of existing) {
      productsByKey.set(productKey(product.site, product.siteProductId), product)
    }
  }
}

const findOrCreateProducts = async (items) => {
  const productsByKey = new Map()
  const isMissing = item => !productsByKey.has(productKey(item.site, item.siteCode))

  await findProducts(items, productsByKey)

  const missing = items.filter(isMissing)
  for (const chunk of _.chunk(missing, DB_CHUNK_SIZE)) {
    // another query running at the same time may insert the same product first;
    // skip those instead of failing on the unique index
    await Product.bulkCreate(chunk.map(item => ({
      site: item.site,
      siteProductId: item.siteCode,
      price: item.price,
      title: item.title,
    })), { ignoreDuplicates: true })
  }

  // load the rows just inserted (by us or the other query) to get their ids
  await findProducts(missing, productsByKey)

  return productsByKey
}

// map of postedKey -> price last posted (null for rows from before per-channel prices)
const findLastPostedPrices = async (productIds, scheduleIds) => {
  const lastPostedPrices = new Map()
  if (productIds.length === 0 || scheduleIds.length === 0) {
    return lastPostedPrices
  }

  for (const chunk of _.chunk(_.uniq(productIds), DB_CHUNK_SIZE)) {
    const rows = await PostedProduct.findAll({
      attributes: ['productId', 'scheduleId', 'price'],
      where: {
        productId: chunk,
        scheduleId: scheduleIds,
      },
      raw: true,
    })
    for (const { productId, scheduleId, price } of rows) {
      lastPostedPrices.set(postedKey(productId, scheduleId), price)
    }
  }

  return lastPostedPrices
}


module.exports = {
  handleQuery,
  enqueuePosts,
}

// this is a shitty way to do this for now, requires a quick refactor to pull out
if(process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    log.error(`Fatal error: ${err.message}`)
    log.error(err.stack)
    process.exitCode = 1
  });
}