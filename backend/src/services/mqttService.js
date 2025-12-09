const mqtt = require('mqtt');
const config = require('../config');
const logger = require('../utils/logger');
const { redis } = require('../config/redis');

class MQTTService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.messageHandlers = new Map();
    this.deviceStates = new Map();
  }

  // Initialize MQTT connection
  async connect() {
    return new Promise((resolve, reject) => {
      const options = {
        clientId: config.mqtt.clientId + '_' + Math.random().toString(16).substr(2, 8),
        username: config.mqtt.username,
        password: config.mqtt.password,
        keepalive: config.mqtt.keepAlive,
        reconnectPeriod: config.mqtt.reconnectPeriod,
        clean: true,
        will: {
          topic: 'server/status',
          payload: JSON.stringify({ status: 'offline', timestamp: new Date() }),
          qos: 1,
          retain: true,
        },
      };

      this.client = mqtt.connect(config.mqtt.broker, options);

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('MQTT broker connected successfully');

        // Subscribe to important topics
        this.subscribeToTopics();

        // Publish server online status
        this.publishServerStatus('online');

        resolve();
      });

      this.client.on('error', (error) => {
        logger.error('MQTT connection error', error);
        this.connected = false;
        reject(error);
      });

      this.client.on('reconnect', () => {
        logger.info('MQTT attempting to reconnect...');
      });

      this.client.on('offline', () => {
        this.connected = false;
        logger.warn('MQTT client offline');
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });
    });
  }

  // Subscribe to all important topics
  subscribeToTopics() {
    const topics = [
      'devices/+/register',
      'devices/+/status',
      'devices/+/telemetry',
      'devices/+/feeding',
      'devices/+/alert',
      'devices/+/heartbeat',
    ];

    topics.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          logger.error(`Failed to subscribe to topic: ${topic}`, err);
        } else {
          logger.info(`Subscribed to topic: ${topic}`);
        }
      });
    });
  }

  // Handle incoming messages
  async handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      logger.debug('MQTT message received', { topic, payload });

      // Extract device ID from topic (e.g., devices/ESP32_ABC123/status)
      const topicParts = topic.split('/');
      const deviceId = topicParts[1];
      const action = topicParts[2];

      // Update device state in Redis
      await this.updateDeviceState(deviceId, action, payload);

      // Route message to appropriate handler
      switch (action) {
        case 'register':
          await this.handleDeviceRegistration(deviceId, payload);
          break;
        case 'status':
          await this.handleDeviceStatus(deviceId, payload);
          break;
        case 'telemetry':
          await this.handleTelemetry(deviceId, payload);
          break;
        case 'feeding':
          await this.handleFeeding(deviceId, payload);
          break;
        case 'alert':
          await this.handleAlert(deviceId, payload);
          break;
        case 'heartbeat':
          await this.handleHeartbeat(deviceId, payload);
          break;
        default:
          logger.warn(`Unknown action: ${action} from device: ${deviceId}`);
      }

      // Call custom handlers if registered
      if (this.messageHandlers.has(action)) {
        const handlers = this.messageHandlers.get(action);
        handlers.forEach((handler) => handler(deviceId, payload));
      }
    } catch (error) {
      logger.error('Error handling MQTT message', { topic, error: error.message });
    }
  }

  // Update device state in Redis
  async updateDeviceState(deviceId, action, payload) {
    const key = `device:${deviceId}:state`;
    const state = {
      lastSeen: new Date().toISOString(),
      lastAction: action,
      payload: payload,
    };
    await redis.hset(`device:${deviceId}`, action, state);
    await redis.expire(`device:${deviceId}`, 3600); // 1 hour TTL
  }

  // Handle device registration
  async handleDeviceRegistration(deviceId, payload) {
    logger.info(`Device registration: ${deviceId}`, payload);

    // Store device info in Redis
    await redis.set(`device:${deviceId}:info`, {
      deviceId,
      macAddress: payload.mac_address,
      firmwareVersion: payload.firmware_version,
      registeredAt: new Date().toISOString(),
    });

    // Send configuration back to device
    this.sendConfig(deviceId, {
      mqtt_topic: `devices/${deviceId}`,
      update_interval: 60,
      timezone: config.timezone,
    });
  }

  // Handle device status updates
  async handleDeviceStatus(deviceId, payload) {
    logger.debug(`Device status: ${deviceId}`, payload);

    // Update in Redis for quick access
    await redis.set(`device:${deviceId}:status`, {
      online: payload.online !== false,
      wifi_rssi: payload.wifi_rssi,
      free_heap: payload.free_heap,
      uptime: payload.uptime,
      timestamp: new Date().toISOString(),
    }, 300); // 5 min TTL
  }

  // Handle telemetry data
  async handleTelemetry(deviceId, payload) {
    logger.debug(`Telemetry from ${deviceId}`, payload);

    // Store in Redis list (keep last 100 readings)
    await redis.lpush(`device:${deviceId}:telemetry`, {
      ...payload,
      timestamp: new Date().toISOString(),
    });

    // TODO: Store in database for long-term analytics
  }

  // Handle feeding events
  async handleFeeding(deviceId, payload) {
    logger.info(`Feeding event: ${deviceId}`, payload);

    // Store feeding event
    await redis.lpush(`device:${deviceId}:feedings`, {
      ...payload,
      timestamp: new Date().toISOString(),
    });

    // TODO: Store in database
    // TODO: Send notification to user
  }

  // Handle alerts
  async handleAlert(deviceId, payload) {
    logger.warn(`Alert from ${deviceId}`, payload);

    // Store alert
    await redis.lpush(`device:${deviceId}:alerts`, {
      ...payload,
      timestamp: new Date().toISOString(),
    });

    // TODO: Send urgent notification to user
  }

  // Handle heartbeat
  async handleHeartbeat(deviceId, payload) {
    await redis.set(`device:${deviceId}:heartbeat`, {
      timestamp: new Date().toISOString(),
      ...payload,
    }, 120); // 2 min TTL
  }

  // Publish message to device
  publish(topic, message, options = {}) {
    if (!this.connected) {
      logger.error('Cannot publish: MQTT client not connected');
      return false;
    }

    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const publishOptions = {
      qos: options.qos || 1,
      retain: options.retain || false,
    };

    this.client.publish(topic, payload, publishOptions, (err) => {
      if (err) {
        logger.error(`Failed to publish to ${topic}`, err);
      } else {
        logger.debug(`Published to ${topic}`, message);
      }
    });

    return true;
  }

  // Send command to specific device
  sendCommand(deviceId, command, data = {}) {
    const topic = `devices/${deviceId}/command`;
    const message = {
      command,
      data,
      timestamp: new Date().toISOString(),
    };
    return this.publish(topic, message);
  }

  // Send configuration to device
  sendConfig(deviceId, config) {
    const topic = `devices/${deviceId}/config`;
    return this.publish(topic, config, { retain: true });
  }

  // Publish server status
  publishServerStatus(status) {
    this.publish('server/status', {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    }, { retain: true });
  }

  // Register custom message handler
  registerHandler(action, handler) {
    if (!this.messageHandlers.has(action)) {
      this.messageHandlers.set(action, []);
    }
    this.messageHandlers.get(action).push(handler);
  }

  // Get device state
  async getDeviceState(deviceId) {
    return await redis.hgetall(`device:${deviceId}`);
  }

  // Get all device telemetry
  async getDeviceTelemetry(deviceId, limit = 100) {
    return await redis.lrange(`device:${deviceId}:telemetry`, 0, limit - 1);
  }

  // Health check
  async healthCheck() {
    return {
      status: this.connected ? 'healthy' : 'unhealthy',
      connected: this.connected,
      clientId: this.client?.options?.clientId,
    };
  }

  // Disconnect
  async disconnect() {
    if (this.client) {
      this.publishServerStatus('offline');
      await new Promise((resolve) => {
        this.client.end(false, resolve);
      });
      this.connected = false;
      logger.info('MQTT client disconnected');
    }
  }
}

// Create singleton instance
const mqttService = new MQTTService();

module.exports = mqttService;
