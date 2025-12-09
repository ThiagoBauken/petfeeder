const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { verifyToken, verifyRefreshToken } = require('../middlewares/auth');
const { validate, authLimiter } = require('../middlewares');

const router = express.Router();

// Register
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').notEmpty().trim(),
    body('timezone').optional().isString(),
    validate,
  ],
  authController.register
);

// Login
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
    body('totpToken').optional().isString(),
    validate,
  ],
  authController.login
);

// Refresh token
router.post(
  '/refresh',
  [body('refreshToken').notEmpty(), validate],
  verifyRefreshToken,
  authController.refresh
);

// Logout
router.post('/logout', verifyToken, authController.logout);

// Get current user
router.get('/me', verifyToken, authController.getMe);

// Get device token (for ESP32 configuration)
router.get('/device-token', verifyToken, authController.getDeviceToken);

// Enable 2FA
router.post('/2fa/enable', verifyToken, authController.enable2FA);

// Verify 2FA
router.post(
  '/2fa/verify',
  verifyToken,
  [body('token').notEmpty().isLength({ min: 6, max: 6 }), validate],
  authController.verify2FA
);

// Disable 2FA
router.post(
  '/2fa/disable',
  verifyToken,
  [body('password').notEmpty(), validate],
  authController.disable2FA
);

module.exports = router;
