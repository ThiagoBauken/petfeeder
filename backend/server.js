const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const database = require('./src/config/database');
const redisClient = require('./src/config/redis');
const mqttService = require('./src/services/mqttService');
const websocketService = require('./src/services/websocketService');
const routes = require('./src/routes');
const { errorHandler, notFound, requestLogger, corsOptions } = require('./src/middlewares');

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// ====================
// MIDDLEWARE SETUP
// ====================

// Security headers
app.use(helmet({
  contentSecurityPolicy: config.isProduction,
  crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors(corsOptions));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser(config.security.cookie.secret));

// HTTP request logging
if (config.isDevelopment) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Custom request logger
app.use(requestLogger);

// ====================
// ROUTES
// ====================

// API routes
app.use('/api', routes);

// Static files (if needed)
app.use('/uploads', express.static('uploads'));

// Health check endpoint (for Docker)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'PetFeeder Backend API',
    version: '1.0.0',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to PetFeeder SaaS API',
    version: '1.0.0',
    environment: config.app.env,
    api: '/api',
    health: '/health',
  });
});

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// ====================
// SERVICES INITIALIZATION
// ====================

async function initializeServices() {
  try {
    logger.info('Initializing services...');

    // Test database connection
    const dbHealth = await database.healthCheck();
    logger.info('Database health check', dbHealth);

    // Test Redis connection
    const redisHealth = await redisClient.redis.healthCheck();
    logger.info('Redis health check', redisHealth);

    // Initialize MQTT
    await mqttService.connect();
    logger.info('MQTT service initialized');

    // Initialize WebSocket
    websocketService.initialize(server);
    websocketService.startHeartbeat();
    logger.info('WebSocket service initialized');

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', error);
    throw error;
  }
}

// ====================
// SERVER STARTUP
// ====================

async function startServer() {
  try {
    // Initialize services
    await initializeServices();

    // Start HTTP server
    server.listen(config.app.port, () => {
      logger.info(`
╔════════════════════════════════════════╗
║     PetFeeder SaaS Backend Server      ║
╠════════════════════════════════════════╣
║ Environment: ${config.app.env.padEnd(25)}  ║
║ HTTP Port: ${String(config.app.port).padEnd(27)} ║
║ WebSocket: ${String(config.app.websocketPort).padEnd(27)} ║
║ Database: Connected                    ║
║ Redis: Connected                       ║
║ MQTT: Connected                        ║
║ WebSocket: Active                      ║
╚════════════════════════════════════════╝
      `);
      logger.info(`Server running on http://localhost:${config.app.port}`);
      logger.info(`API available at http://localhost:${config.app.port}/api`);
    });

    // Separate WebSocket server (if different port)
    if (config.app.websocketPort !== config.app.port) {
      const wsServer = http.createServer();
      websocketService.initialize(wsServer);
      wsServer.listen(config.app.websocketPort, () => {
        logger.info(`WebSocket server running on port ${config.app.websocketPort}`);
      });
    }
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// ====================
// GRACEFUL SHUTDOWN
// ====================

async function gracefulShutdown(signal) {
  logger.info(`${signal} received, starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Shutdown services
    await mqttService.disconnect();
    logger.info('MQTT disconnected');

    websocketService.shutdown();
    logger.info('WebSocket closed');

    await database.close();
    logger.info('Database connections closed');

    await redisClient.close();
    logger.info('Redis connection closed');

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ====================
// START THE SERVER
// ====================

if (require.main === module) {
  startServer();
}

module.exports = { app, server };
