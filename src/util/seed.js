require('dotenv').config()
const db = require('../db')

const {SearchQuery} = require('../db/models')

async function seed() {
  await db.sync({force: true})
  console.log('db synced!')

  const queries = await Promise.all([
    SearchQuery.create({site: 'YAJ', query: '東方 ふもふも', desc: '"touhou fumofumo"'}),
  ])

  console.log(`seeded ${queries.length} queries`)
  console.log(`seeded successfully`)
}

// We've separated the `seed` function from the `runSeed` function.
// This way we can isolate the error handling and exit trapping.
// The `seed` function is concerned only with modifying the database.
async function runSeed() {
  console.log('seeding...')
  try {
    await seed()
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
