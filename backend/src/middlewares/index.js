const rateLimit = require('express-rate-limit');
const { validationResult } = require('express-validator');
const config = require('../config');
const logger = require('../utils/logger');

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Error caught by middleware', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  // Handle different error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors,
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(config.isDevelopment && { stack: err.stack }),
  });
};

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

// Rate limiting
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs: windowMs || config.security.rateLimit.windowMs,
    max: max || config.security.rateLimit.max,
    message: message || 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        url: req.url,
      });
      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
      });
    },
  });
};

// General rate limiter
const generalLimiter = createRateLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes

// Auth rate limiter (stricter)
const authLimiter = createRateLimiter(15 * 60 * 1000, 5); // 5 requests per 15 minutes

// API rate limiter
const apiLimiter = createRateLimiter(1 * 60 * 1000, 30); // 30 requests per minute

// Not found handler
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.url,
  });
};

// Request logger
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    });
  });

  next();
};

// CORS handler
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = config.security.cors.origin;

    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: config.security.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
  maxAge: 86400, // 24 hours
};

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Check ownership middleware
const checkOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const resourceId = req.params.id;

      // TODO: Implement ownership check based on resourceType
      // For now, just pass through
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Pagination middleware
const paginate = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  req.pagination = {
    page,
    limit,
    offset,
  };

  // Helper function to send paginated response
  res.paginate = (data, total) => {
    const totalPages = Math.ceil(total / limit);
    res.set('X-Total-Count', total);
    res.set('X-Page', page);
    res.set('X-Per-Page', limit);
    res.set('X-Total-Pages', totalPages);

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  };

  next();
};

// Cache middleware
const cache = (duration = 60) => {
  return (req, res, next) => {
    const key = `cache:${req.url}`;

    // Check cache
    const cached = req.app.locals.cache?.get(key);
    if (cached) {
      return res.json(cached);
    }

    // Store original send
    const originalSend = res.json.bind(res);

    // Override send
    res.json = (body) => {
      // Store in cache
      req.app.locals.cache?.set(key, body, duration);
      return originalSend(body);
    };

    next();
  };
};

module.exports = {
  errorHandler,
  validate,
  generalLimiter,
  authLimiter,
  apiLimiter,
  createRateLimiter,
  notFound,
  requestLogger,
  corsOptions,
  asyncHandler,
  checkOwnership,
  paginate,
  cache,
};
