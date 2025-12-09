const express = require('express');
const { body, param } = require('express-validator');
const devicesController = require('../controllers/devicesController');
const { verifyToken, verifyUserToken } = require('../middlewares/auth');
const { validate, apiLimiter } = require('../middlewares');

const router = express.Router();

// ==================== ROTAS PUBLICAS (ESP32) ====================

// Registro inicial do ESP32 (usa token do usuario)
router.post(
  '/register',
  [
    body('deviceId').notEmpty().isString(),
    body('userToken').notEmpty().isString(),
    body('deviceType').optional().isString(),
    body('firmware').optional().isString(),
    body('mac').optional().isString(),
    body('ip').optional().isString(),
    validate,
  ],
  devicesController.registerDevice
);

// ==================== ROTAS AUTENTICADAS ====================

// All routes below require authentication
router.use(verifyToken);

// Get all devices
router.get('/', apiLimiter, devicesController.getDevices);

// Get single device
router.get(
  '/:id',
  [param('id').isInt(), validate],
  devicesController.getDevice
);

// Link device
router.post(
  '/link',
  [
    body('deviceId').notEmpty().isString(),
    body('name').optional().isString().trim(),
    validate,
  ],
  devicesController.linkDevice
);

// Update device
router.put(
  '/:id',
  [
    param('id').isInt(),
    body('name').optional().isString().trim(),
    body('location').optional().isString().trim(),
    body('timezone').optional().isString(),
    validate,
  ],
  devicesController.updateDevice
);

// Delete device
router.delete(
  '/:id',
  [param('id').isInt(), validate],
  devicesController.deleteDevice
);

// Send command to device
router.post(
  '/:id/command',
  [
    param('id').isInt(),
    body('command').notEmpty().isString(),
    body('data').optional().isObject(),
    validate,
  ],
  devicesController.sendCommand
);

// Get device telemetry
router.get(
  '/:id/telemetry',
  [param('id').isInt(), validate],
  devicesController.getTelemetry
);

// Restart device
router.post(
  '/:id/restart',
  [param('id').isInt(), validate],
  devicesController.restartDevice
);

module.exports = router;
