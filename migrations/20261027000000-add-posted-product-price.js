module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.sequelize.transaction(async t => {
      await queryInterface.addColumn('postedProducts', 'price', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
      }, { transaction: t });
      // existing posts were made at (roughly) the product's current price; without this every
      // already-posted item would look like a price change on the next run
      await queryInterface.sequelize.query(`
        UPDATE "postedProducts" pp
        SET price = p.price
        FROM products p
        WHERE p.id = pp."productId"
      `, { transaction: t });
    });
  },
  down: (queryInterface) => {
    return queryInterface.removeColumn('postedProducts', 'price');
  }
};
