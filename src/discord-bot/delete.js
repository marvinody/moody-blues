const Eris = require("eris");
const Constants = Eris.Constants;

const { Schedule, SearchQuery } = require('../db/models');

const name = "delete";
const command = {
  name,
  description: "Delete a search query in this channel",
  options: [
    {
      name: "query",
      description: "Query to search for (generally in Japanese)",
      type: Constants.ApplicationCommandOptionTypes.INTEGER,
      required: true,
      autocomplete: true,
    },
   
  ],
  type: Constants.ApplicationCommandTypes.CHAT_INPUT //Not required for Chat input type, but recommended
}



/**
 * @param {Eris.Client} bot
 * @param {Eris.AutocompleteInteraction} interaction
 * @returns {number}
 */
const autocomplete = async (bot, interaction) => {

  
  const guildId = interaction.guildID;
  const channelId = interaction.channel.id;

  console.log({guildId, channelId})

  const queries = await SearchQuery.findAll({
    include: [
      {
        model: Schedule,
        where: {
          guildId,
          channelId,
          enabled: true
        }
      }
    ]
  })

  const results = queries.map(query => ({
    name: `"${query.query}" (${query.desc}) @ ${query.site}`,
    value: query.id,
  }))

  return interaction.acknowledge(results)

}

/**
 * @param {Eris.Client} bot
 * @param {Eris.CommandInteraction} interaction
 * @returns {number}
 */
const action = async (bot, interaction) => {

  const guildId = interaction.guildID;
  const channelId = interaction.channel.id;

  const searchQueryId = interaction.data.options.find(opt => opt.name === 'query').value;

  await Schedule.update({
    enabled: false,
  }, {
    where: {
      guildId,
      channelId,
      searchQueryId,
    },
  })

  return interaction.createMessage("Query Deleted!");

}

module.exports = {
  name,
  command,
  action,
  autocomplete,
}