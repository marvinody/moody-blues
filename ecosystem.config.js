// pm2 config for the long-running services: `pm2 start ecosystem.config.js`
// The hourly search run (`npm run bot`) is scheduled in crontab, not here.
// Both services read their secrets from .env in the repo folder, so they run from here.
module.exports = {
  apps: [
    {
      // slash-command bot
      name: 'moody-discord',
      // run node directly (not `npm run`) so pm2's stop signal reaches the bot itself
      script: 'src/discord-bot/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      exp_backoff_restart_delay: 1000,
    },
    {
      // drains the post queue into Discord
      name: 'moody-blues-sender',
      script: 'src/sender/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      // one sender paces requests; more instances would multiply the request rate
      instances: 1,
      autorestart: true,
      // back off restarts if it keeps crashing (e.g. database down)
      exp_backoff_restart_delay: 1000,
      // pm2 sends SIGINT on stop/restart; give an in-flight request time to finish
      // (discord requests time out after 30s) before pm2 force-kills it
      kill_timeout: 40000,
    },
  ],
}
