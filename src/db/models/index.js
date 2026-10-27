const Product = require('./Product')
const Schedule = require('./Schedule')
const SearchQuery = require('./SearchQuery')
const PostedProduct = require('./PostedProduct')
const QueuedPost = require('./QueuedPost')

SearchQuery.hasMany(Schedule)
Schedule.belongsTo(SearchQuery)


Product.belongsToMany(Schedule, { through: PostedProduct })
Schedule.belongsToMany(Product, { through: PostedProduct })

QueuedPost.belongsTo(Product, { onDelete: 'CASCADE' })
QueuedPost.belongsTo(Schedule, { onDelete: 'CASCADE' })


module.exports = {
  Product,
  Schedule,
  SearchQuery,
  PostedProduct,
  QueuedPost,
}
