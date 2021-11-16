const Product = require('./Product')
const Schedule = require('./Schedule')
const SearchQuery = require('./SearchQuery')
const PostedProduct = require('./PostedProduct')

SearchQuery.hasMany(Schedule)
Schedule.belongsTo(SearchQuery)


Product.belongsToMany(Schedule, { through: PostedProduct })
Schedule.belongsToMany(Product, { through: PostedProduct })


module.exports = {
  Product,
  Schedule,
  SearchQuery,
  PostedProduct,
}
