require('dotenv').config()
const { Schedule, SearchQuery, PostedProduct, Product } = require('./db/models')
const _ = require('lodash')
const searchService = require('./services/searchService')
const discordService = require('./services/discordService')

const groupPosts = (posts) => {
  const postsWithIdx = posts.map((p, idx) => ({ ...p, idx }));

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


const cyrb53 = function (str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const _makeYAJEmbed = (yajItem) => {
  const
    fields = [
      {
        name: 'Price:',
        value: `${yajItem.price}円`,
        inline: false,
      },
    ]
  if (yajItem.type === 'BUYOUT') {
    fields.push({
      name: 'Buy It Now For:',
      value: `${yajItem.buyoutPrice}円`,
      inline: false,
    })
  }
  const buyeeLink = yajItem.url.replace("page.auctions.yahoo.co.jp/jp",
    "buyee.jp/item/yahoo")
  const description = `${yajItem.title}\n【[YAJ](${yajItem.url})】　【[Buyee](${buyeeLink})】\n`

  return {
    fields,
    description,
  }
}

const makeEmbed = (item) => {
  let siteEmbed = {};
  switch (item.site) {
    case 'YAJ':
      siteEmbed = _makeYAJEmbed(item);
      break;
    default:
      siteEmbed = {};
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

    for (let idx = 0; idx < queries.length; idx++) {
      const { site, query, schedules } = queries[idx];

      // make site dynamic and fetch all results instead of paging through
      // probably abstract to the service to let it do that
      const items = await searchService.search(site, query)

      await Promise.all(items.map(async (item) => {
        const [product, _] = await Product.findOrCreate({
          where: {
            site: item.site,
            siteProductId: item.siteCode,
          },
          defaults: {
            site: item.site,
            siteProductId: item.siteCode,
            price: item.price,
            title: item.title,
          }
        });

        if(product.price !== item.price) {
          await product.update({
            price: item.price
          })
        }

        await Promise.all(schedules.map(async ({ id, webhookURL }) => {
          const [_postedProduct, created] = await PostedProduct.findOrCreate({
            where: {
              productId: product.id,
              scheduleId: id,
            },
            defaults: {
              productId: product.id,
              scheduleId: id,
            }
          });

          if (created) {
            postsToMake.push({ webhookURL, item })
          }
        }))
      }))


    }

  } catch (err) {
    console.error(err);
    await discordService.postError(err)

  } finally {
    console.log(`Making ${postsToMake.length} posts`)

    const groupedPosts = groupPosts(postsToMake)
    for (let idx = 0; idx < groupedPosts.length; idx++) {
      const post = groupedPosts[idx];
      try {
        await sendWebhook(post)
      } catch (err) {
        console.error(`Uncaught error in webhook: ${err.message}`)
        console.error(err.stack)
      }
    }
  }

}


main();
