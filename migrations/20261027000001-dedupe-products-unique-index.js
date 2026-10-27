// Removes duplicate products (same site + siteProductId) left by the old racy findOrCreate,
// then makes (site, siteProductId) unique so they can't come back.
// The oldest row in each group is kept, since that's the one the bot uses.
module.exports = {
  up: (queryInterface) => {
    return queryInterface.sequelize.transaction(async transaction => {
      const query = (sql) => queryInterface.sequelize.query(sql, { transaction })

      await query(`
        CREATE TEMP TABLE product_dupes ON COMMIT DROP AS
        SELECT p.id AS duplicate_id, k.keeper_id
        FROM products p
        JOIN (
          SELECT site, "siteProductId", min(id) AS keeper_id
          FROM products
          GROUP BY site, "siteProductId"
          HAVING count(*) > 1
        ) k ON k.site = p.site AND k."siteProductId" = p."siteProductId"
        WHERE p.id <> k.keeper_id
      `)

      // move posted records onto the kept product; if the kept product already has a record
      // for that schedule, its own record wins
      await query(`
        INSERT INTO "postedProducts" ("productId", "scheduleId", price, "createdAt", "updatedAt")
        SELECT d.keeper_id, pp."scheduleId", pp.price, pp."createdAt", pp."updatedAt"
        FROM "postedProducts" pp
        JOIN product_dupes d ON d.duplicate_id = pp."productId"
        ON CONFLICT ("productId", "scheduleId") DO NOTHING
      `)

      await query(`DELETE FROM "postedProducts" WHERE "productId" IN (SELECT duplicate_id FROM product_dupes)`)
      await query(`DELETE FROM products WHERE id IN (SELECT duplicate_id FROM product_dupes)`)

      await query(`DROP INDEX IF EXISTS products_site_site_product_id`)
      await query(`CREATE UNIQUE INDEX products_site_site_product_id ON products (site, "siteProductId")`)
    });
  },
  // deleted duplicates can't be restored; this only puts the non-unique index back
  down: (queryInterface) => {
    return queryInterface.sequelize.transaction(async transaction => {
      const query = (sql) => queryInterface.sequelize.query(sql, { transaction })
      await query(`DROP INDEX IF EXISTS products_site_site_product_id`)
      await query(`CREATE INDEX products_site_site_product_id ON products (site, "siteProductId")`)
    });
  }
};
