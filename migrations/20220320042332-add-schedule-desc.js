module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction(t => {
      return Promise.all([
        queryInterface.addColumn('schedules', 'channelDesc', {
          type: Sequelize.DataTypes.TEXT
        }, { transaction: t }),
      ]);
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction(t => {
      return Promise.all([
        queryInterface.removeColumn('schedules', 'channelDesc', { transaction: t }),
      ]);
    });
  }
};
