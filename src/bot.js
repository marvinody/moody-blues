require('dotenv').config()

const searchService = require('./services/searchService')


async function main() {
  const { hasMore, items } = await searchService.yaj({
    query: '東方 ふもふも',
    page: 1,
  })
  console.log({ hasMore, items })
}


main();
