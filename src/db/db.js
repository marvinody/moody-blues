const Sequelize = require('sequelize')
const pkg = require('../../package.json')

const databaseName = pkg.name + (process.env.NODE_ENV === 'test' ? '-test' : '')

let config

if (process.env.DATABASE_URL) {
  config = {
    logging: false,
    ssl: true,
    acquire: 60000,
    max: 100,
    min: 0,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
} else {
  config = {
    logging: false
  }
}

let dbString = process.env.DATABASE_URL ?? `postgres://localhost:5432/${databaseName}`

if(process.env.NODE_ENV === 'test') {
  dbString = 'sqlite::memory:';
  config.logging = true;
}

const db = new Sequelize(
  dbString,
  config
)

module.exports = db
