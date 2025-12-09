const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create transports
const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    format: config.isDevelopment ? consoleFormat : logFormat,
  })
);

// File transport for errors
transports.push(
  new DailyRotateFile({
    filename: `${config.logging.dir}/error-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    format: logFormat,
    maxFiles: config.logging.maxFiles,
    maxSize: config.logging.maxSize,
  })
);

// File transport for all logs
transports.push(
  new DailyRotateFile({
    filename: `${config.logging.dir}/combined-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    format: logFormat,
    maxFiles: config.logging.maxFiles,
    maxSize: config.logging.maxSize,
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename: `${config.logging.dir}/exceptions-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles: config.logging.maxFiles,
      maxSize: config.logging.maxSize,
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: `${config.logging.dir}/rejections-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles: config.logging.maxFiles,
      maxSize: config.logging.maxSize,
    }),
  ],
});

// Create log directory if it doesn't exist
const fs = require('fs');
const path = require('path');
if (!fs.existsSync(config.logging.dir)) {
  fs.mkdirSync(config.logging.dir, { recursive: true });
}

module.exports = logger;
