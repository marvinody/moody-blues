require('dotenv').config()
const { Schedule, SearchQuery, PostedProduct, Product } = require('./db/models')
const _ = require('lodash')
const searchService = require('./services/searchService')
const discordService = require('./services/discordService')
const asyncPool = require('tiny-async-pool')
const log = require('./util/logger')
const { cyrb53 } = require("./util/cyrb53")

const groupPosts = (posts) => {
  // same item for the same webhook (e.g. two schedules sharing a channel) is posted once,
  // but every schedule's record is kept so they're all marked as posted
  const postsByKey = new Map()
  for (const post of posts) {
    const key = `${post.webhookURL}\u0000${post.item.item.siteCode}`
    const existing = postsByKey.get(key)
    if (existing) {
      existing.records.push(...(post.records ?? []))
    } else {
      postsByKey.set(key, { ...post, records: [...(post.records ?? [])] })
    }
  }
  const dedupedPosts = [...postsByKey.values()]

  const duplicatedPostCount = posts.length - dedupedPosts.length;
  log.info(`Duped posts: ${duplicatedPostCount}`)

  const postsWithIdx = dedupedPosts.map((p, idx) => ({ ...p, idx }));

  const groupedByWebhook = _.groupBy(postsWithIdx, 'webhookURL');

  const chunkedByWebhook = _.mapValues(groupedByWebhook, x => _.chunk(x, 10))

  const flattened = _.flatMap(chunkedByWebhook)

  // use lowest idx in each chunk to determine sorting
  const sortedByPrio = _.sortBy(flattened, [l => Math.min(..._.map(l, 'idx'))])

  const remappedPosts = _.map(sortedByPrio, chunk => ({
    webhookURL: chunk[0].webhookURL,
    items: _.map(chunk, 'item'),
    records: _.flatMap(chunk, 'records'),
  }))

  return remappedPosts

}


const formatToYen = (() => {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY' })

  return (n) => formatter.format(n)
})();

const _makeYAJEmbed = (yajItem) => {
  const
    fields = [];
  if (yajItem.type === 'AUCTION' || yajItem.type === 'AUCTION_WITH_BUYOUT') {
    fields.push({
      name: 'Current Price:',
      value: formatToYen(yajItem.price),
      inline: false,
    })
  }

  if (yajItem.type === 'BUYOUT' || yajItem.type === 'AUCTION_WITH_BUYOUT') {
    fields.push({
      name: 'Buy It Now For:',
      value: formatToYen(yajItem.buyoutPrice),
      inline: false,
    })
  }
  const buyeeLink = `https://buyee.jp/top/search?query=${yajItem.url}`
  const description = `${yajItem.title}\n【[YAJ](${yajItem.url})】　【[Buyee](${buyeeLink})】\n`

  return {
    fields,
    description,
  }
}

const _makeLashinBangEmbed = (lashinItem) => {
  const
    fields = [
      {
        name: 'Price:',
        value: formatToYen(lashinItem.price),
        inline: false,
      },
    ]

  const description = `${lashinItem.title}\n【[Product Page](${lashinItem.url})】\n`

  return {
    fields,
    description,
  }
}

const _makeMercariEmbed = (mercariItem) => {
  const
    fields = [
      {
        name: 'Price:',
        value: formatToYen(mercariItem.price),
        inline: false,
      },
    ]

  // Mercari doesn't have a specific product page, just the listing
  const description = `${mercariItem.title}\n【[Product Page](${mercariItem.url})】\n`
  // if there's an auction property, it means it's an auction listing
  fields.push({
    name: 'type',
    // type is all caps, but we want to display it in a more human readable format
    // e.g. "AUCTION" -> "Auction"
    value: mercariItem.type ? mercariItem.type.charAt(0).toUpperCase() + mercariItem.type.slice(1).toLowerCase() : 'N/A',
    inline: true,
  })

  // if it's an auction, show total bids
  if (mercariItem.type === 'AUCTION' && mercariItem.auction?.totalBids) {
    fields.push({
      name: 'Total Bids:',
      value: mercariItem.auction?.totalBids.toString(),
      inline: true,
    })
  }

  return {
    fields,
    description,
  }
}

const makeEmbed = ({ item, priceChanged, oldPrice, }) => {
  let siteEmbed = {};
  switch (item.site) {
    case 'YAJ':
      siteEmbed = _makeYAJEmbed(item);
      break;
    case 'LASHINBANG':
      siteEmbed = _makeLashinBangEmbed(item);
      break;
    case 'MERCARI':
      siteEmbed = _makeMercariEmbed(item);
      break;
    default:
      siteEmbed = {
        fields: [
          {
            name: 'Price:',
            value: formatToYen(item.price),
            inline: false,
          },
        ]
      };
  }

  if (priceChanged && siteEmbed.fields) {
    siteEmbed.fields.push({
      name: 'Old Price:',
      value: formatToYen(oldPrice),
      inline: false,
    })
  }

  return {
    color: cyrb53(item.siteCode) & 0xffffff,
    title: `【${item.site}】 - ${item.siteCode}`,
    description: item.title,
    url: item.url,
    image: {
      url: item.imageURL,
    },
    ...siteEmbed,
    footer: {
      text: 'Moody Blues'
    }
  }
}

// returns true only if discord accepted the post
const sendWebhook = async ({ webhookURL, items }) => {
  const embeds = items.map(makeEmbed)
  return discordService.postWebhook({ webhookURL, embeds })
}

const sendPosts = async (groupedPosts) => {
  for (let idx = 0; idx < groupedPosts.length; idx++) {
    const post = groupedPosts[idx];
    try {
      if (await sendWebhook(post)) {
        await recordPosted(post.records)
      }
    } catch (err) {
      log.error(`Uncaught error in webhook: ${err.message}`)
      log.error(err.stack)
    }
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
    log.info(`Making ${postsToMake.length} posts`)

    await sendPosts(groupPosts(postsToMake))
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
        postsToMake.push({
          webhookURL,
          item: {
            item,
            priceChanged,
            oldPrice,
          },
          // only written once discord accepts the post, so a killed or failed run reposts next time
          records: [{ productId: product.id, scheduleId: id, price: item.price }],
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

// records which products each schedule has been shown, and at what price, after a successful post
const recordPosted = async (records) => {
  // the same product/schedule pair can't appear twice in one upsert
  const uniqueRecords = _.uniqBy(records, ({ productId, scheduleId }) => postedKey(productId, scheduleId))
  for (const chunk of _.chunk(uniqueRecords, DB_CHUNK_SIZE)) {
    await PostedProduct.bulkCreate(chunk, { updateOnDuplicate: ['price', 'updatedAt'] })
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
  groupPosts,
  sendPosts,
}

// this is a shitty way to do this for now, requires a quick refactor to pull out
if(process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    log.error(`Fatal error: ${err.message}`)
    log.error(err.stack)
    process.exitCode = 1
  });
}