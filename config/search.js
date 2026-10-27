// Tuning for how hard we hit the rem search service.
// Each value can be overridden with the env var of the same name.

const fromEnv = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback
}

module.exports = {
  // pages fetched per search query each run, for sites rem doesn't sort by newest
  // (new listings can be on any page, so these need to go deeper)
  SEARCH_MAX_PAGES_PER_QUERY: fromEnv('SEARCH_MAX_PAGES_PER_QUERY', 10),

  // per-site overrides of SEARCH_MAX_PAGES_PER_QUERY, keyed by site name as stored on search queries.
  // rem sorts YAJ by newest, so new listings are always on the first pages
  SEARCH_MAX_PAGES_PER_QUERY_BY_SITE: {
    YAJ: fromEnv('SEARCH_MAX_PAGES_PER_QUERY_YAJ', 2),
  },

  // hard cap on items kept per search query, in case pages are huge
  SEARCH_MAX_ITEMS_PER_QUERY: fromEnv('SEARCH_MAX_ITEMS_PER_QUERY', 1500),

  // requests to the same site run one at a time, with this gap after each one finishes
  SEARCH_DELAY_BETWEEN_REQUESTS_PER_SITE_MS: fromEnv('SEARCH_DELAY_BETWEEN_REQUESTS_PER_SITE_MS', 3000),

  // give up on a rem request that hasn't answered in this long, so one stuck request
  // can't block that site's queue (and the whole run) forever
  SEARCH_REQUEST_TIMEOUT_MS: fromEnv('SEARCH_REQUEST_TIMEOUT_MS', 60000),

  // random extra wait (0 to this value) added to each gap so requests don't look machine-timed
  SEARCH_RANDOM_EXTRA_DELAY_MAX_MS: fromEnv('SEARCH_RANDOM_EXTRA_DELAY_MAX_MS', 2000),
}
