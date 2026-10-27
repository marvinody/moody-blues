const { cyrb53 } = require("./cyrb53")

const formatToYen = (() => {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY' })

  return (n) => formatter.format(n)
})();

const _makeYAJEmbed = (yajItem) => {
  const
    fields = [];
  if (yajItem.type === 'AUCTION' || yajItem.type === 'AUCTION_WITH_BUYOUT') {
    fields.push({
      name: 'Current Price:',
      value: formatToYen(yajItem.price),
      inline: false,
    })
  }

  if (yajItem.type === 'BUYOUT' || yajItem.type === 'AUCTION_WITH_BUYOUT') {
    fields.push({
      name: 'Buy It Now For:',
      value: formatToYen(yajItem.buyoutPrice),
      inline: false,
    })
  }
  const buyeeLink = `https://buyee.jp/top/search?query=${yajItem.url}`
  const description = `${yajItem.title}\n【[YAJ](${yajItem.url})】　【[Buyee](${buyeeLink})】\n`

  return {
    fields,
    description,
  }
}

const _makeLashinBangEmbed = (lashinItem) => {
  const
    fields = [
      {
        name: 'Price:',
        value: formatToYen(lashinItem.price),
        inline: false,
      },
    ]

  const description = `${lashinItem.title}\n【[Product Page](${lashinItem.url})】\n`

  return {
    fields,
    description,
  }
}

const _makeMercariEmbed = (mercariItem) => {
  const
    fields = [
      {
        name: 'Price:',
        value: formatToYen(mercariItem.price),
        inline: false,
      },
    ]

  // Mercari doesn't have a specific product page, just the listing
  const description = `${mercariItem.title}\n【[Product Page](${mercariItem.url})】\n`
  // if there's an auction property, it means it's an auction listing
  fields.push({
    name: 'type',
    // type is all caps, but we want to display it in a more human readable format
    // e.g. "AUCTION" -> "Auction"
    value: mercariItem.type ? mercariItem.type.charAt(0).toUpperCase() + mercariItem.type.slice(1).toLowerCase() : 'N/A',
    inline: true,
  })

  // if it's an auction, show total bids
  if (mercariItem.type === 'AUCTION' && mercariItem.auction?.totalBids) {
    fields.push({
      name: 'Total Bids:',
      value: mercariItem.auction?.totalBids.toString(),
      inline: true,
    })
  }

  return {
    fields,
    description,
  }
}

const makeEmbed = ({ item, priceChanged, oldPrice, }) => {
  let siteEmbed = {};
  switch (item.site) {
    case 'YAJ':
      siteEmbed = _makeYAJEmbed(item);
      break;
    case 'LASHINBANG':
      siteEmbed = _makeLashinBangEmbed(item);
      break;
    case 'MERCARI':
      siteEmbed = _makeMercariEmbed(item);
      break;
    default:
      siteEmbed = {
        fields: [
          {
            name: 'Price:',
            value: formatToYen(item.price),
            inline: false,
          },
        ]
      };
  }

  if (priceChanged && siteEmbed.fields) {
    siteEmbed.fields.push({
      name: 'Old Price:',
      value: formatToYen(oldPrice),
      inline: false,
    })
  }

  return {
    color: cyrb53(item.siteCode) & 0xffffff,
    title: `【${item.site}】 - ${item.siteCode}`,
    description: item.title,
    url: item.url,
    image: {
      url: item.imageURL,
    },
    ...siteEmbed,
    footer: {
      text: 'Moody Blues'
    }
  }
}

module.exports = makeEmbed
