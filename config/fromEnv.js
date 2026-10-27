// reads a numeric setting from the env var of the same name, falling back to the default
const fromEnv = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback
}

module.exports = fromEnv
