const Sequelize = require('sequelize')
const db = require('../db')

const PostedProduct = db.define('postedProduct', {
  // price this schedule's channel was last shown, used to detect price changes per channel
  price: {
    type: Sequelize.INTEGER,
    allowNull: true,
  },
})

module.exports = PostedProduct

