const Sequelize = require('sequelize')
const db = require('../db')

// a post waiting for the sender service, one per product per schedule
const QueuedPost = db.define('queuedPost', {
  productId: {
    type: Sequelize.INTEGER,
    primaryKey: true,
  },
  scheduleId: {
    type: Sequelize.INTEGER,
    primaryKey: true,
  },
  webhookURL: {
    type: Sequelize.TEXT,
    allowNull: false,
  },
  // { item, priceChanged, oldPrice }, turned into an embed at send time
  payload: {
    type: Sequelize.JSON,
    allowNull: false,
  },
  // recorded on postedProducts once discord accepts the post
  price: {
    type: Sequelize.INTEGER,
    allowNull: false,
  },
  attempts: {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // not sent before this time (rate limits, retry backoff, or a claim lease)
  availableAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.NOW,
  },
  lastError: {
    type: Sequelize.TEXT,
    allowNull: true,
  },
}, {
  indexes: [
    {
      fields: ['availableAt'],
    },
    {
      fields: ['webhookURL', 'availableAt'],
    },
  ]
})

module.exports = QueuedPost
