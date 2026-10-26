require('dotenv').config()
const { Schedule, SearchQuery, PostedProduct, Product } = require('./db/models')
const _ = require('lodash')
const searchService = require('./services/searchService')
const discordService = require('./services/discordService')
const asyncPool = require('tiny-async-pool')
const log = require('./util/logger')
const { cyrb53 } = require("./util/cyrb53")

const groupPosts = (posts) => {
  const dedupedPosts = _.uniqWith(posts, (a, b) => {
    return a.item.item.siteCode === b.item.item.siteCode 
    && a.webhookURL === b.webhookURL
  });

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

const sendWebhook = async ({ webhookURL, items }) => {
  const embeds = items.map(makeEmbed)
  await discordService.postWebhook({ webhookURL, embeds })
}

async function main() {

  const postsToMake = [];

  log.info(`Clearing up all previous dirty rows`);
  await Product.update({
    isdirty: false,
  }, {
    where: {
      isdirty: true,
    }
  })

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

    const groupedPosts = groupPosts(postsToMake)
    for (let idx = 0; idx < groupedPosts.length; idx++) {
      const post = groupedPosts[idx];
      try {
        await sendWebhook(post)
      } catch (err) {
        log.error(`Uncaught error in webhook: ${err.message}`)
        log.error(err.stack)
      }
    }
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

  const itemsToPost = []
  const productsToUpdate = []

  for (const item of items) {
    const product = productsByKey.get(productKey(item.site, item.siteCode))

    const priceChanged = product.price !== item.price
    const oldPrice = product.price

    // if price went up, price diff < 0
    // if price went down, price diff > 0
    const priceDifference = oldPrice - item.price
    const priceDecreased = priceDifference > 0

    // a little confusing, but if a previous query updated a product, we want other queries to also know
    // they don't need to update the product again, but we need to send messages potentially
    const isDirty = product.isdirty;
    // the negation makes it easier to reason if it's been touched yet
    const isClean = !isDirty
    // if it's a small change, we don't want to broadcast
    if(priceDecreased && priceDifference <= 1000 && isClean) {
      continue;
    }

    if (item.price > 900000) {
      continue;
    }

    if (priceChanged && isClean) {
      productsToUpdate.push({ product, price: item.price })
    }

    itemsToPost.push({ item, product, priceChanged, oldPrice, isDirty })
  }

  // price changes are usually a small fraction of items, so individual updates are fine
  for await (const _ of asyncPool(4, productsToUpdate, ({ product, price }) => product.update({
    price,
    isdirty: true,
  }))) {
  }

  const alreadyPosted = await findPostedPairs(
    itemsToPost.map(({ product }) => product.id),
    schedules.map(({ id }) => id),
  )

  const postedProductsToCreate = []
  for (const { item, product, priceChanged, oldPrice, isDirty } of itemsToPost) {
    for (const { id, webhookURL } of schedules) {
      const created = !alreadyPosted.has(postedKey(product.id, id))
      if (created) {
        postedProductsToCreate.push({ productId: product.id, scheduleId: id })
      }

      if (created || priceChanged || isDirty) {
        postsToMake.push({
          webhookURL, item: {
            item,
            priceChanged,
            oldPrice,
          }
        })
      }
    }
  }

  for (const chunk of _.chunk(postedProductsToCreate, DB_CHUNK_SIZE)) {
    await PostedProduct.bulkCreate(chunk, { ignoreDuplicates: true })
  }
}

// keeps IN (...) lists under sqlite's bound parameter limit and postgres query sizes sane
const DB_CHUNK_SIZE = 500

const productKey = (site, siteProductId) => `${site}\u0000${siteProductId}`
const postedKey = (productId, scheduleId) => `${productId}:${scheduleId}`

const findOrCreateProducts = async (items) => {
  const productsByKey = new Map()
  const sites = _.uniq(items.map(item => item.site))

  for (const chunk of _.chunk(items, DB_CHUNK_SIZE)) {
    const existing = await Product.findAll({
      where: {
        site: sites,
        siteProductId: chunk.map(item => item.siteCode),
      },
      // if there are older duplicate rows, consistently use the oldest one
      order: [['id', 'ASC']],
    })
    for (const product of existing) {
      const key = productKey(product.site, product.siteProductId)
      if (!productsByKey.has(key)) {
        productsByKey.set(key, product)
      }
    }
  }

  const missing = items.filter(item => !productsByKey.has(productKey(item.site, item.siteCode)))
  for (const chunk of _.chunk(missing, DB_CHUNK_SIZE)) {
    const created = await Product.bulkCreate(chunk.map(item => ({
      site: item.site,
      siteProductId: item.siteCode,
      price: item.price,
      title: item.title,
      isdirty: true,
    })), { returning: true })
    for (const product of created) {
      productsByKey.set(productKey(product.site, product.siteProductId), product)
    }
  }

  return productsByKey
}

const findPostedPairs = async (productIds, scheduleIds) => {
  const posted = new Set()
  if (productIds.length === 0 || scheduleIds.length === 0) {
    return posted
  }

  for (const chunk of _.chunk(_.uniq(productIds), DB_CHUNK_SIZE)) {
    const rows = await PostedProduct.findAll({
      attributes: ['productId', 'scheduleId'],
      where: {
        productId: chunk,
        scheduleId: scheduleIds,
      },
      raw: true,
    })
    for (const { productId, scheduleId } of rows) {
      posted.add(postedKey(productId, scheduleId))
    }
  }

  return posted
}


module.exports = {
  handleQuery,
  groupPosts,
}

// this is a shitty way to do this for now, requires a quick refactor to pull out
if(process.env.NODE_ENV !== 'test') {
  main();
}