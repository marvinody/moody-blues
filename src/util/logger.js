const winston = require('winston');
const { combine, timestamp, printf, colorize, align } = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    colorize({ all: true }),
    timestamp({
      format: 'YYYY-MM-DD hh:mm:ss.SSS A',
    }),
    align(),
    printf((info) => {
      if(info.site && info.query) {
        return `[${info.timestamp}] ${info.level}: [${info.site} - ${info.query}] ${info.message}`
      }
      
      return `[${info.timestamp}] ${info.level}: ${info.message}`
    })
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger