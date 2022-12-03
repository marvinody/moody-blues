const Eris = require("eris");
require('dotenv').config();

const Sentry = require("@sentry/node");
require("@sentry/tracing");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  maxBreadcrumbs: 1,
});

const create = require('./create');
const get = require('./get');
const deleteCom = require('./delete');

const commands = [
  create,
  get,
  deleteCom,
]

// name -> autocomplete (if exists)
const autocompleteHandlers = new Map(
  commands
    .filter(c => c.autocomplete)
    .map(c => ([c.name, c.autocomplete]))
)

// name -> action
const actionHandlers = new Map(
  commands
    .map(c => ([c.name, c.action]))
)

const GUILD_ID = process.env.DEV_GUILD_ID;

// Replace TOKEN with your bot account's token
const bot = new Eris(process.env.BOT_TOKEN, {
  intents: [
    "guilds"
  ] 
});

bot.on("ready", async () => { // When the bot is ready
  console.log("Loading!");

  console.log(`${commands.length} commands detected`)
  
  const commandsPayload = commands.map(c => c.command);
  if (process.env.NODE_ENV === 'prod') {
    console.log('Loading Global Commands')
    await bot.bulkEditCommands(commandsPayload)
  } else {
    console.log('Loading Guild Commands')
    await bot.bulkEditGuildCommands(GUILD_ID, commandsPayload)
  }

  console.log("Ready!");

});

bot.on("error", (err) => {
  console.error(err); // or your preferred logger
});

bot.on("interactionCreate", (interaction) => {
  try {
    if (interaction instanceof Eris.CommandInteraction) {
      if (actionHandlers.has(interaction.data.name)) {
        const handler = actionHandlers.get(interaction.data.name);
        return handler(bot, interaction)
      }
    }

    if (interaction instanceof Eris.AutocompleteInteraction) {
      if (autocompleteHandlers.has(interaction.data.name)) {
        const handler = autocompleteHandlers.get(interaction.data.name);
        return handler(bot, interaction)
      }
    }
  } catch (err) {
    Sentry.captureException(err);
  }
});

bot.connect(); // Get the bot to connect to Discord
