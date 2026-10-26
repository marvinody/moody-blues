module.exports = {
  up: (queryInterface) => {
    return queryInterface.addIndex('products', ['site', 'siteProductId'], {
      name: 'products_site_site_product_id',
    });
  },
  down: (queryInterface) => {
    return queryInterface.removeIndex('products', 'products_site_site_product_id');
  }
};
