const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const { redis } = require('../config/redis');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Check if token is blacklisted
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, config.security.jwt.secret);

    // Attach user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      plan: decoded.plan,
      role: decoded.role || 'user',
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    logger.error('Token verification error', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Verify refresh token
const verifyRefreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided',
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, config.security.jwt.refreshSecret);

    // Check if refresh token is valid in Redis
    const storedToken = await redis.get(`refresh:${decoded.userId}`);
    if (!storedToken || storedToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      plan: decoded.plan,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired',
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    logger.error('Refresh token verification error', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Check if user has required plan
const requirePlan = (...allowedPlans) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!allowedPlans.includes(req.user.plan)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient plan',
        requiredPlan: allowedPlans,
        currentPlan: req.user.plan,
      });
    }

    next();
  };
};

// Check if user has required role
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        requiredRole: allowedRoles,
        currentRole: req.user.role,
      });
    }

    next();
  };
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, config.security.jwt.secret);
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        plan: decoded.plan,
        role: decoded.role || 'user',
      };
    }
  } catch (error) {
    // Ignore errors for optional auth
  }
  next();
};

module.exports = {
  verifyToken,
  verifyRefreshToken,
  requirePlan,
  requireRole,
  optionalAuth,
};
