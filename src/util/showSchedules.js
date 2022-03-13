require('dotenv').config()

const db = require('../db')
const { Schedule } = require('../db/models')

async function showSchedules() {
  const sq = await Schedule.findAll({
    raw: true,
  });
  console.table(sq)
}


async function main() {
  try {
    await showSchedules()
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
