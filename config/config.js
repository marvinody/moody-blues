// Load environment variable from .env file
require('dotenv').config();
const pkg = require('../package.json')

// mirror src/db/db.js so migrations hit the same database the bot uses
const databaseName = pkg.name + (process.env.NODE_ENV === 'test' ? '-test' : '')

const config = process.env.DATABASE_URL
  ? {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
  : {
    url: `postgres://localhost:5432/${databaseName}`,
    dialect: 'postgres',
  }

// sequelize-cli looks up config by NODE_ENV, which isn't always one of the standard names (e.g. "dev")
module.exports = {
  development: config,
  test: config,
  production: config,
  [process.env.NODE_ENV || 'development']: config,
}
