// WebSocket Client for PetFeeder
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = CONFIG.WS_MAX_RECONNECT_ATTEMPTS;
    this.reconnectInterval = CONFIG.WS_RECONNECT_INTERVAL;
    this.eventHandlers = new Map();
    this.connected = false;
    this.authenticated = false;
    this.subscriptions = new Set();
  }

  // Connect to WebSocket
  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.trigger('connected');

        // Authenticate if we have a token
        const token = localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
        const userData = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USER_DATA) || '{}');

        if (token && userData.id) {
          this.authenticate(token, userData.id);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.trigger('error', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.connected = false;
        this.authenticated = false;
        this.trigger('disconnected');
        this.reconnect();
      };

      // Setup heartbeat
      this.startHeartbeat();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.reconnect();
    }
  }

  // Reconnect to WebSocket
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.trigger('max_reconnect_attempts');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  // Authenticate with server
  authenticate(token, userId) {
    this.send({
      type: 'authenticate',
      token,
      userId,
    });
  }

  // Subscribe to topics
  subscribe(topics) {
    if (!Array.isArray(topics)) {
      topics = [topics];
    }

    topics.forEach((topic) => this.subscriptions.add(topic));

    this.send({
      type: 'subscribe',
      topics,
    });
  }

  // Unsubscribe from topics
  unsubscribe(topics) {
    if (!Array.isArray(topics)) {
      topics = [topics];
    }

    topics.forEach((topic) => this.subscriptions.delete(topic));

    this.send({
      type: 'unsubscribe',
      topics,
    });
  }

  // Send message
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message not sent:', message);
    }
  }

  // Send command
  sendCommand(command, data = {}) {
    this.send({
      type: 'command',
      command,
      data,
    });
  }

  // Handle incoming message
  handleMessage(message) {
    console.log('WebSocket message:', message);

    switch (message.type) {
      case 'connected':
        break;

      case 'authenticated':
        this.authenticated = true;
        this.trigger('authenticated', message);
        // Resubscribe to previous topics
        if (this.subscriptions.size > 0) {
          this.subscribe(Array.from(this.subscriptions));
        }
        break;

      case 'auth_error':
        console.error('Authentication error:', message.message);
        this.trigger('auth_error', message);
        break;

      case 'subscribed':
        this.trigger('subscribed', message.topics);
        break;

      case 'device_status':
        this.trigger('device_status', message);
        break;

      case 'feeding':
        this.trigger('feeding', message);
        break;

      case 'alert':
        this.trigger('alert', message);
        break;

      case 'pong':
        break;

      case 'error':
        console.error('WebSocket error message:', message.message);
        this.trigger('error', message);
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }

    // Trigger generic message handler
    this.trigger('message', message);
  }

  // Register event handler
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  // Remove event handler
  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // Trigger event
  trigger(event, data = null) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // Start heartbeat
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        this.send({ type: 'ping' });
      }
    }, 30000); // 30 seconds
  }

  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Disconnect
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  // Get connection status
  isConnected() {
    return this.connected && this.authenticated;
  }
}

// Create global WebSocket instance
const ws = new WebSocketClient(CONFIG.WS_URL);

// Auto-connect if user is logged in
if (localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN)) {
  ws.connect();
}
