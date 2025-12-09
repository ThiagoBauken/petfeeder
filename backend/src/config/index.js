require('dotenv').config();

module.exports = {
  // Application
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT) || 3000,
    websocketPort: parseInt(process.env.WEBSOCKET_PORT) || 8080,
    domain: process.env.DOMAIN || 'localhost',
    name: process.env.APP_NAME || 'PetFeeder SaaS',
  },

  // Database
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'petfeeder',
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME || 'petfeeder',
    ssl: process.env.DB_SSL === 'true',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
    },
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    ttl: parseInt(process.env.REDIS_TTL) || 3600,
  },

  // MQTT
  mqtt: {
    broker: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT) || 1883,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: process.env.MQTT_CLIENT_ID || 'petfeeder-server',
    keepAlive: parseInt(process.env.MQTT_KEEP_ALIVE) || 60,
    reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_PERIOD) || 5000,
  },

  // Security
  security: {
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    cookie: {
      secret: process.env.COOKIE_SECRET,
    },
    session: {
      secret: process.env.SESSION_SECRET,
    },
    encryption: {
      key: process.env.ENCRYPTION_KEY,
    },
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
      credentials: process.env.CORS_CREDENTIALS === 'true',
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    },
  },

  // Email
  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    from: process.env.SMTP_FROM || 'PetFeeder <noreply@petfeeder.com>',
  },

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    successUrl: process.env.STRIPE_SUCCESS_URL,
    cancelUrl: process.env.STRIPE_CANCEL_URL,
    prices: {
      basic: process.env.STRIPE_PRICE_BASIC,
      premium: process.env.STRIPE_PRICE_PREMIUM,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
    },
  },

  // Storage
  storage: {
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880,
    allowedFileTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/jpg'],
    s3: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET,
      endpoint: process.env.S3_ENDPOINT,
    },
  },

  // Monitoring
  monitoring: {
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 1.0,
    },
    prometheus: {
      port: parseInt(process.env.PROMETHEUS_PORT) || 9090,
      enabled: process.env.METRICS_ENABLED === 'true',
    },
    grafana: {
      port: parseInt(process.env.GRAFANA_PORT) || 3002,
      user: process.env.GRAFANA_USER || 'admin',
      password: process.env.GRAFANA_PASSWORD || 'admin',
    },
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
  },

  // 2FA
  twoFactor: {
    enabled: process.env.TWO_FACTOR_ENABLED === 'true',
    issuer: process.env.TWO_FACTOR_ISSUER || 'PetFeeder',
    window: parseInt(process.env.TWO_FACTOR_WINDOW) || 1,
  },

  // Notifications
  notifications: {
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      enabled: process.env.TELEGRAM_ENABLED === 'true',
    },
    whatsapp: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      number: process.env.TWILIO_WHATSAPP_NUMBER,
      enabled: process.env.WHATSAPP_ENABLED === 'true',
    },
  },

  // Features
  features: {
    otaUpdates: process.env.FEATURE_OTA_UPDATES === 'true',
    analytics: process.env.FEATURE_ANALYTICS === 'true',
    webhooks: process.env.FEATURE_WEBHOOKS === 'true',
    apiV2: process.env.FEATURE_API_V2 === 'true',
  },

  // Limits
  limits: {
    devices: {
      free: parseInt(process.env.MAX_DEVICES_FREE) || 1,
      basic: parseInt(process.env.MAX_DEVICES_BASIC) || 3,
      premium: parseInt(process.env.MAX_DEVICES_PREMIUM) || 10,
    },
    petsPerDevice: parseInt(process.env.MAX_PETS_PER_DEVICE) || 3,
    schedules: {
      free: parseInt(process.env.MAX_SCHEDULES_FREE) || 3,
      basic: parseInt(process.env.MAX_SCHEDULES_BASIC) || 10,
      premium: parseInt(process.env.MAX_SCHEDULES_PREMIUM) || 50,
    },
  },

  // Backup
  backup: {
    enabled: process.env.BACKUP_ENABLED === 'true',
    dir: process.env.BACKUP_DIR || './backups',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
  },

  // SSL/TLS
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    certPath: process.env.SSL_CERT_PATH,
    keyPath: process.env.SSL_KEY_PATH,
  },

  // Health Check
  healthCheck: {
    enabled: process.env.HEALTH_CHECK_ENABLED === 'true',
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
  },

  // Timezone
  timezone: process.env.TZ || process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo',

  // Development
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
};
