const Eris = require("eris");
const Constants = Eris.Constants;

const { Schedule, SearchQuery } = require('../db/models');

const name = "get";
const command = {
  name,
  dm_permission: false,
  description: "Get all queries running in this channel",
  type: Constants.ApplicationCommandTypes.CHAT_INPUT //Not required for Chat input type, but recommended
}

/**
 * @param {Eris.Client} bot
 * @param {Eris.CommandInteraction} interaction
 */
const action = async (bot, interaction) => {

  const guildId = interaction.guildID;
  const channelId = interaction.channel.id;

  const schedules = await Schedule.findAll({
    where: {
      channelId,
      guildId,
      enabled: true,
    },
    include: [SearchQuery]
  });

  if(schedules.length === 0) {
    return interaction.createMessage("No queries active, use /create to make some");
  }

  const mappedSchedules = schedules.map((sch, idx) => `${idx + 1}: "${sch.searchQuery.query}" (${sch.searchQuery.desc}) @ ${sch.searchQuery.site}`)

  return interaction.createMessage(mappedSchedules.join('\n'));

}

module.exports = {
  name,
  command,
  action
}