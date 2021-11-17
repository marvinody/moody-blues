require('dotenv').config()
const { Schedule, SearchQuery, PostedProduct, Product } = require('./db/models')
const searchService = require('./services/searchService')


const sendWebhook = (webhook, item) => {
  console.log(`Sending webhook to ${webhook} for item.title: "${item.title}"`)
}

async function main() {

  const queries = await SearchQuery.findAll({
    include: Schedule
  })

  for (let idx = 0; idx < queries.length; idx++) {
    const { site, query, schedules } = queries[idx];

    // make site dynamic and fetch all results instead of paging through
    // probably abstract to the service to let it do that
    const { hasMore, items } = await searchService.yaj({
      query,
      page: 1,
    })

    console.log(items[0])
    items.forEach(async (item) => {
      const [product, _] = await Product.findOrCreate({
        where: {
          site: item.site,
          siteProductId: item.siteCode,
          price: item.price,
        },
        defaults: {
          site: item.site,
          siteProductId: item.siteCode,
          price: item.price,
          title: item.title,
        }
      });

      schedules.forEach(async ({id, webhookURL}) => {
        const [postedProduct, created] = await PostedProduct.findOrCreate({
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
          sendWebhook(webhookURL, item)
        }
      })
    })
  }



}


main();
