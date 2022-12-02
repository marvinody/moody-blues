const Eris = require("eris");
require('dotenv').config()
const create = require('./create');
const get = require('./get');
const deleteCom = require('./delete');

const GUILD_ID = '915469626148806716'

// Replace TOKEN with your bot account's token
const bot = new Eris(process.env.BOT_TOKEN, {
    intents: [] //No intents are needed for interactions, but you still need to specify either an empty array or 0
});

bot.on("ready", async () => { // When the bot is ready
    console.log("Loading!");

    //Note: You should use guild commands to test, as they update instantly. Global commands can take up to an hour to update.

    const globalCommands = await bot.getCommands();
    const commands = await bot.getGuildCommands(GUILD_ID);
    
    console.log(`${globalCommands.length} global commands detected`)
    console.log(`${commands.length} guild commands detected`)


    // await Promise.all(globalCommands.map(c => bot.deleteCommand(c.id)))
    
    // await Promise.all(commands.map(c => bot.deleteGuildCommand(GUILD_ID, c.id)))
    // if (!commands.length) {

    await bot.bulkEditGuildCommands(GUILD_ID, [
        create.command,
        get.command,
        deleteCom.command
    ])
        //In practice, you should use bulkEditCommands if you need to create multiple commands
    // }

    console.log("Ready!");

});

bot.on("error", (err) => {
    console.error(err); // or your preferred logger
});

bot.on("interactionCreate", (interaction) => {
    if (interaction instanceof Eris.CommandInteraction) {
        switch (interaction.data.name) {

            case "test_delete_command":
                interaction.createMessage("interaction recieved");
                return bot.deleteCommand(interaction.data.id);
            case create.name:
                return create.action(bot, interaction);
            case get.name:
                return get.action(bot, interaction);
            case deleteCom.name:
                return deleteCom.action(bot, interaction);
            default: {
                return interaction.createMessage("interaction recieved");
            }
        }
    }

    if(interaction instanceof Eris.AutocompleteInteraction) {
        switch (interaction.data.name) {
            case deleteCom.name:
                return deleteCom.autocomplete(bot, interaction)
        }
    }
});

bot.connect(); // Get the bot to connect to Discord
