// Frontend Configuration
const CONFIG = {
  // API Configuration - Usa URL relativa (mesmo servidor serve frontend e backend)
  API_URL: window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : `${window.location.origin}/api`,

  // WebSocket Configuration
  WS_URL: window.location.hostname === 'localhost'
    ? 'ws://localhost:8081'
    : `wss://${window.location.host.replace('telegram-petfeeder', 'telegram-petfeeder-ws')}`,

  // Local Storage Keys
  STORAGE_KEYS: {
    ACCESS_TOKEN: 'petfeeder_access_token',
    REFRESH_TOKEN: 'petfeeder_refresh_token',
    USER_DATA: 'petfeeder_user_data',
  },

  // App Settings
  APP_NAME: 'PetFeeder',
  VERSION: '1.0.0',

  // WebSocket Settings
  WS_RECONNECT_INTERVAL: 5000,
  WS_MAX_RECONNECT_ATTEMPTS: 10,

  // API Settings
  API_TIMEOUT: 30000,

  // Polling intervals (when WebSocket is not available)
  POLLING_INTERVAL: 10000,

  // UI Settings
  TOAST_DURATION: 3000,
  MAX_UPLOAD_SIZE: 5 * 1024 * 1024, // 5MB
};

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
