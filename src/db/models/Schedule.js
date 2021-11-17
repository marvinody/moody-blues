const Sequelize = require('sequelize')
const db = require('../db')

const Schedule = db.define('schedule', {
  webhookURL: {
    type: Sequelize.TEXT,
    allowNull: false
  },
})

module.exports = Schedule


