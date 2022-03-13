require('dotenv').config()

const db = require('../db')
const { SearchQuery } = require('../db/models')

async function showSearchQueries() {
  const sq = await SearchQuery.findAll({
    raw: true,
  });
  console.table(sq)
}


async function main() {
  try {
    await showSearchQueries()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    console.log('closing db connection')
    await db.close()
    console.log('db connection closed')
  }
}

main();
