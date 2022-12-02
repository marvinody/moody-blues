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
}, {
  indexes: [
    {
      unique: true,
      fields: ['site', 'query']
    },
  ]
});

SearchQuery.addQueriesToAllSites = function ({
  sites,
  query,
  desc,
}) {
  return this.bulkCreate(sites.map(site => ({
    site,
    query,
    desc,
  })), {
    updateOnDuplicate: ['desc']
  })
};


module.exports = SearchQuery


