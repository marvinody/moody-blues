const db = require('../db')
const { Schedule } = require('../db/models')

async function addSchedule() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    throw new Error("Please pass query string & webhook url in quotes to add to schedule")
  }

  const queryId = args[0];
  const webhookURL = args[1];

  const schedule = await Schedule.create({
    searchQueryId: queryId,
    webhookURL,
  })

  console.log(`Added schedule(id=${schedule.id})`)
}


async function runSeed() {
  try {
    await addSchedule()
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
