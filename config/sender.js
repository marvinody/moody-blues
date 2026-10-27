// Tuning for the sender service that drains the post queue into Discord.
// Each value can be overridden with the env var of the same name.
const fromEnv = require('./fromEnv')

module.exports = {
  // gap between webhook requests; keeps us well under Discord's limits
  SENDER_DELAY_BETWEEN_POSTS_MS: fromEnv('SENDER_DELAY_BETWEEN_POSTS_MS', 2000),

  // embeds per webhook message (Discord allows at most 10)
  SENDER_MAX_EMBEDS_PER_POST: fromEnv('SENDER_MAX_EMBEDS_PER_POST', 10),

  // how often to check the queue when idle; new posts also wake the sender right away
  SENDER_IDLE_POLL_INTERVAL_MS: fromEnv('SENDER_IDLE_POLL_INTERVAL_MS', 30000),

  // a claimed batch is retried after this long if the sender dies mid-send
  SENDER_CLAIM_LEASE_MS: fromEnv('SENDER_CLAIM_LEASE_MS', 2 * 60 * 1000),

  // failed sends (not rate limits) are retried this many times before the batch is dropped
  SENDER_MAX_ATTEMPTS: fromEnv('SENDER_MAX_ATTEMPTS', 5),

  // wait before retrying a failed send; doubles each attempt, up to the max
  SENDER_RETRY_BACKOFF_BASE_MS: fromEnv('SENDER_RETRY_BACKOFF_BASE_MS', 60 * 1000),
  SENDER_RETRY_BACKOFF_MAX_MS: fromEnv('SENDER_RETRY_BACKOFF_MAX_MS', 60 * 60 * 1000),

  // queued posts older than this are dropped; the listing has probably sold by then
  SENDER_MAX_QUEUE_AGE_HOURS: fromEnv('SENDER_MAX_QUEUE_AGE_HOURS', 72),
}
