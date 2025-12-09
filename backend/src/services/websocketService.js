const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { redis } = require('../config/redis');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // userId -> Set of WebSocket connections
    this.connectionInfo = new Map(); // ws -> { userId, deviceId, subscriptions }
  }

  // Initialize WebSocket server
  initialize(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error', error);
    });

    logger.info('WebSocket server initialized');
  }

  // Handle new connection
  handleConnection(ws, req) {
    const connectionId = uuidv4();
    ws.id = connectionId;

    logger.info(`WebSocket client connected: ${connectionId}`);

    // Send welcome message
    this.send(ws, {
      type: 'connected',
      connectionId,
      message: 'Connected to PetFeeder WebSocket server',
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for connection ${connectionId}`, error);
    });

    // Setup ping/pong for keepalive
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  // Handle incoming messages
  async handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('WebSocket message received', { connectionId: ws.id, message });

      switch (message.type) {
        case 'authenticate':
          await this.handleAuthentication(ws, message);
          break;
        case 'subscribe':
          await this.handleSubscribe(ws, message);
          break;
        case 'unsubscribe':
          await this.handleUnsubscribe(ws, message);
          break;
        case 'command':
          await this.handleCommand(ws, message);
          break;
        case 'ping':
          this.send(ws, { type: 'pong', timestamp: Date.now() });
          break;
        default:
          this.send(ws, { type: 'error', message: 'Unknown message type' });
      }
    } catch (error) {
      logger.error('Error handling WebSocket message', error);
      this.send(ws, { type: 'error', message: 'Invalid message format' });
    }
  }

  // Handle authentication
  async handleAuthentication(ws, message) {
    const { token, userId } = message;

    // TODO: Verify JWT token
    // For now, just accept the userId
    if (!userId) {
      this.send(ws, { type: 'auth_error', message: 'User ID required' });
      return;
    }

    // Store connection info
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId).add(ws);

    this.connectionInfo.set(ws, {
      userId,
      subscriptions: new Set(),
      authenticatedAt: new Date(),
    });

    this.send(ws, {
      type: 'authenticated',
      userId,
      message: 'Successfully authenticated',
    });

    logger.info(`WebSocket client authenticated: ${ws.id} as user ${userId}`);
  }

  // Handle subscribe to topics
  async handleSubscribe(ws, message) {
    const info = this.connectionInfo.get(ws);
    if (!info) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    const { topics } = message;
    if (!Array.isArray(topics)) {
      this.send(ws, { type: 'error', message: 'Topics must be an array' });
      return;
    }

    topics.forEach((topic) => {
      info.subscriptions.add(topic);
    });

    this.send(ws, {
      type: 'subscribed',
      topics,
      message: 'Successfully subscribed to topics',
    });

    logger.debug(`Client ${ws.id} subscribed to topics`, topics);
  }

  // Handle unsubscribe from topics
  async handleUnsubscribe(ws, message) {
    const info = this.connectionInfo.get(ws);
    if (!info) {
      return;
    }

    const { topics } = message;
    if (!Array.isArray(topics)) {
      return;
    }

    topics.forEach((topic) => {
      info.subscriptions.delete(topic);
    });

    this.send(ws, {
      type: 'unsubscribed',
      topics,
    });
  }

  // Handle commands from client
  async handleCommand(ws, message) {
    const info = this.connectionInfo.get(ws);
    if (!info) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    const { command, data } = message;

    // TODO: Process command and send to MQTT or database
    logger.info(`Command received from ${info.userId}`, { command, data });

    this.send(ws, {
      type: 'command_ack',
      command,
      message: 'Command received',
    });
  }

  // Handle disconnection
  handleDisconnect(ws) {
    const info = this.connectionInfo.get(ws);

    if (info && info.userId) {
      const userClients = this.clients.get(info.userId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) {
          this.clients.delete(info.userId);
        }
      }
    }

    this.connectionInfo.delete(ws);
    logger.info(`WebSocket client disconnected: ${ws.id}`);
  }

  // Send message to specific WebSocket connection
  send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // Broadcast to all authenticated clients
  broadcast(message) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && this.connectionInfo.has(client)) {
        this.send(client, message);
      }
    });
  }

  // Send to specific user (all their connections)
  sendToUser(userId, message) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.forEach((ws) => {
        this.send(ws, message);
      });
    }
  }

  // Send to users subscribed to a topic
  sendToTopic(topic, message) {
    this.wss.clients.forEach((ws) => {
      const info = this.connectionInfo.get(ws);
      if (info && info.subscriptions.has(topic)) {
        this.send(ws, { ...message, topic });
      }
    });
  }

  // Send device status update
  notifyDeviceStatus(deviceId, status) {
    this.sendToTopic(`device:${deviceId}`, {
      type: 'device_status',
      deviceId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  // Send feeding event
  notifyFeeding(deviceId, feedingData) {
    this.sendToTopic(`device:${deviceId}`, {
      type: 'feeding',
      deviceId,
      data: feedingData,
      timestamp: new Date().toISOString(),
    });
  }

  // Send alert
  notifyAlert(userId, alertData) {
    this.sendToUser(userId, {
      type: 'alert',
      data: alertData,
      timestamp: new Date().toISOString(),
    });
  }

  // Keepalive ping
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  // Get connection stats
  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      authenticatedUsers: this.clients.size,
      connections: Array.from(this.connectionInfo.entries()).map(([ws, info]) => ({
        id: ws.id,
        userId: info.userId,
        subscriptions: Array.from(info.subscriptions),
        authenticatedAt: info.authenticatedAt,
      })),
    };
  }

  // Health check
  healthCheck() {
    return {
      status: this.wss ? 'healthy' : 'unhealthy',
      connections: this.wss?.clients.size || 0,
      authenticatedUsers: this.clients.size,
    };
  }

  // Shutdown
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.wss) {
      this.wss.clients.forEach((ws) => {
        ws.close(1000, 'Server shutting down');
      });
      this.wss.close();
      logger.info('WebSocket server shut down');
    }
  }
}

// Create singleton instance
const websocketService = new WebSocketService();

module.exports = websocketService;
