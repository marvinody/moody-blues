const Sequelize = require('sequelize')
const db = require('../db')

const Product = db.define('product', {
  site: {
    type: Sequelize.STRING,
    allowNull: false
  },
  siteProductId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  title: {
    type: Sequelize.TEXT,
    allowNull: false,
  },
  price: {
    type: Sequelize.INTEGER,
    allowNull: false,
  },
  isdirty: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }
})

module.exports = Product


