const Sequelize = require('sequelize')
const db = require('../db')

const SearchQuery = db.define('searchQuery', {
  site: {
    type: Sequelize.STRING,
    allowNull: false
  },
  query: {
    type: Sequelize.STRING,
    allowNull: false
  },
  desc: {
    type: Sequelize.TEXT,
  }
})

module.exports = SearchQuery


