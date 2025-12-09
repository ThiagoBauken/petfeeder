const redis = require('redis');
const config = require('./index');
const logger = require('../utils/logger');

// Create Redis client
const client = redis.createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
  },
  password: config.redis.password,
  database: config.redis.db,
});

// Error handling
client.on('error', (err) => {
  logger.error('Redis Client Error', err);
});

client.on('connect', () => {
  logger.info('Redis client connected successfully');
});

client.on('ready', () => {
  logger.info('Redis client ready');
});

// Connect to Redis
(async () => {
  try {
    await client.connect();
  } catch (error) {
    logger.error('Failed to connect to Redis', error);
  }
})();

// Helper functions
const redisHelper = {
  // Get value
  get: async (key) => {
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis GET error', { key, error: error.message });
      throw error;
    }
  },

  // Set value with TTL
  set: async (key, value, ttl = config.redis.ttl) => {
    try {
      const serialized = JSON.stringify(value);
      await client.setEx(key, ttl, serialized);
      return true;
    } catch (error) {
      logger.error('Redis SET error', { key, error: error.message });
      throw error;
    }
  },

  // Delete key
  del: async (key) => {
    try {
      await client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis DEL error', { key, error: error.message });
      throw error;
    }
  },

  // Check if key exists
  exists: async (key) => {
    try {
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error', { key, error: error.message });
      throw error;
    }
  },

  // Increment value
  incr: async (key) => {
    try {
      return await client.incr(key);
    } catch (error) {
      logger.error('Redis INCR error', { key, error: error.message });
      throw error;
    }
  },

  // Set with expiration
  expire: async (key, seconds) => {
    try {
      await client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error('Redis EXPIRE error', { key, error: error.message });
      throw error;
    }
  },

  // Get multiple keys
  mget: async (keys) => {
    try {
      const values = await client.mGet(keys);
      return values.map((v) => (v ? JSON.parse(v) : null));
    } catch (error) {
      logger.error('Redis MGET error', { keys, error: error.message });
      throw error;
    }
  },

  // Hash operations
  hset: async (key, field, value) => {
    try {
      await client.hSet(key, field, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis HSET error', { key, field, error: error.message });
      throw error;
    }
  },

  hget: async (key, field) => {
    try {
      const value = await client.hGet(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis HGET error', { key, field, error: error.message });
      throw error;
    }
  },

  hgetall: async (key) => {
    try {
      const hash = await client.hGetAll(key);
      const result = {};
      for (const [field, value] of Object.entries(hash)) {
        result[field] = JSON.parse(value);
      }
      return result;
    } catch (error) {
      logger.error('Redis HGETALL error', { key, error: error.message });
      throw error;
    }
  },

  // List operations
  lpush: async (key, value) => {
    try {
      await client.lPush(key, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis LPUSH error', { key, error: error.message });
      throw error;
    }
  },

  lrange: async (key, start, stop) => {
    try {
      const values = await client.lRange(key, start, stop);
      return values.map((v) => JSON.parse(v));
    } catch (error) {
      logger.error('Redis LRANGE error', { key, error: error.message });
      throw error;
    }
  },

  // Pub/Sub
  publish: async (channel, message) => {
    try {
      await client.publish(channel, JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error('Redis PUBLISH error', { channel, error: error.message });
      throw error;
    }
  },

  // Health check
  healthCheck: async () => {
    try {
      const pong = await client.ping();
      const info = await client.info('server');
      return {
        status: 'healthy',
        ping: pong,
        info: info.split('\r\n').slice(0, 5).join('\n'),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  },
};

// Graceful shutdown
const close = async () => {
  try {
    await client.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis connection', error);
    throw error;
  }
};

module.exports = {
  client,
  redis: redisHelper,
  close,
};
