const Sequelize = require('sequelize')
const db = require('../db')

const Schedule = db.define('schedule', {
  webhookURL: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  enabled: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  channelDesc: {
    type: Sequelize.TEXT,
    allowNull: true,
  }
})

Schedule.disableWebhook = function(webhookURL) {
  return this.update({
    enabled: false,
  }, {
    where: {
      webhookURL
    }
  })
}


module.exports = Schedule


