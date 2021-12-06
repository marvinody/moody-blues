require('dotenv').config()

const db = require('../db')
const { SearchQuery } = require('../db/models')

async function addSearchQuery() {
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    throw new Error("Please pass 'site', 'query', and 'desc' in quotes to add to query")
  }

  const site = args[0];
  const query = args[1];
  const desc = args[2];

  const sq = await SearchQuery.create({ site, query, desc });

  console.log(`Added query(id=${sq.id})`)
}


async function runSeed() {
  try {
    await addSearchQuery()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    console.log('closing db connection')
    await db.close()
    console.log('db connection closed')
  }
}

runSeed();
