module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable('queuedPosts', {
        productId: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          references: { model: 'products', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        scheduleId: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          references: { model: 'schedules', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        webhookURL: { type: Sequelize.TEXT, allowNull: false },
        payload: { type: Sequelize.JSON, allowNull: false },
        price: { type: Sequelize.INTEGER, allowNull: false },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        availableAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        lastError: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('queuedPosts', ['availableAt'], {
        name: 'queued_posts_available_at', transaction,
      });
      await queryInterface.addIndex('queuedPosts', ['webhookURL', 'availableAt'], {
        name: 'queued_posts_webhook_u_r_l_available_at', transaction,
      });
    });
  },
  down: (queryInterface) => {
    return queryInterface.dropTable('queuedPosts');
  }
};
