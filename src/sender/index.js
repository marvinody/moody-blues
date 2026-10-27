// Long-running service that drains the post queue into Discord, one paced request at a time.
// Run it under pm2 (see ecosystem.config.js); it exits cleanly on SIGINT/SIGTERM after
// finishing the request in flight, and exits with an error if its LISTEN connection drops
// so pm2 restarts it.
require('dotenv').config()
const db = require('../db')
const log = require('../util/logger')
const settings = require('../../config/sender')
const queue = require('./queue')
const { processNextBatch } = require('./sender')

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

let stopping = false
let wakeUp = null

// sleeps until the time passes, a queue notification arrives, or we're asked to stop
const sleep = (ms) => new Promise(resolve => {
  const timer = setTimeout(done, ms)
  function done() {
    clearTimeout(timer)
    wakeUp = null
    resolve()
  }
  wakeUp = done
})

const stop = (signal) => {
  if (stopping) {
    return
  }
  log.info(`Received ${signal}, stopping after the current send`)
  stopping = true
  wakeUp?.()
}

// holds one pooled connection for LISTEN so new posts wake the sender immediately
const listenForNewPosts = async () => {
  if (db.getDialect() !== 'postgres') {
    return null
  }
  const connection = await db.connectionManager.getConnection()
  connection.on('notification', () => wakeUp?.())
  connection.on('error', (err) => {
    log.error(`Lost the queue LISTEN connection: ${err.message}`)
    process.exit(1)
  })
  await connection.query(`LISTEN ${queue.QUEUE_NOTIFY_CHANNEL}`)
  return connection
}

// how long to wait when nothing is ready: until the next post is due, at most one poll interval
const idleWaitMs = async () => {
  const next = await queue.nextAvailableAt()
  if (!next) {
    return settings.SENDER_IDLE_POLL_INTERVAL_MS
  }
  const untilNext = new Date(next).getTime() - Date.now()
  return Math.min(Math.max(untilNext, settings.SENDER_DELAY_BETWEEN_POSTS_MS), settings.SENDER_IDLE_POLL_INTERVAL_MS)
}

async function main() {
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  const listener = await listenForNewPosts()
  log.info(`Sender started, ${await queue.queueSize()} post(s) queued`)

  let lastCleanup = 0
  while (!stopping) {
    let waitMs = settings.SENDER_DELAY_BETWEEN_POSTS_MS
    try {
      if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
        const { tooOld, disabled } = await queue.cleanupQueue({
          now: new Date(),
          maxAgeHours: settings.SENDER_MAX_QUEUE_AGE_HOURS,
        })
        if (tooOld + disabled > 0) {
          log.info(`Dropped ${tooOld} expired and ${disabled} disabled-schedule post(s) from the queue`)
        }
        lastCleanup = Date.now()
      }

      const outcome = await processNextBatch()
      if (outcome.pauseAllMs) {
        waitMs = outcome.pauseAllMs
      } else if (outcome.idle) {
        waitMs = await idleWaitMs()
      }
    } catch (err) {
      // e.g. the database is unreachable; keep the process up and try again later
      log.error(`Sender loop error: ${err.message}`)
      log.error(err.stack)
      waitMs = settings.SENDER_IDLE_POLL_INTERVAL_MS
    }

    if (!stopping) {
      await sleep(waitMs)
    }
  }

  if (listener) {
    db.connectionManager.releaseConnection(listener)
  }
  await db.close()
  log.info('Sender stopped')
}

main().catch(err => {
  log.error(`Sender crashed: ${err.message}`)
  log.error(err.stack)
  process.exit(1)
})
