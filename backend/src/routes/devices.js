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

// Auto-registro do ESP32 (usa email do usuario)
router.post(
  '/auto-register',
  [
    body('deviceId').notEmpty().isString(),
    body('email').notEmpty().isEmail(),
    body('name').optional().isString(),
    validate,
  ],
  devicesController.autoRegisterDevice
);

// ESP32 envia status (rota publica - dispositivo se identifica pelo deviceId)
router.post(
  '/:deviceId/status',
  [
    param('deviceId').notEmpty().isString(),
    body('food_level').optional().isInt({ min: 0, max: 100 }),
    body('rssi').optional().isInt(),
    body('ip').optional().isString(),
    body('mode').optional().isString(),
    body('power_save_enabled').optional().isBoolean(),
    validate,
  ],
  devicesController.updateDeviceStatus
);

// ESP32 busca horarios agendados (rota publica)
router.get(
  '/:deviceId/schedules',
  [param('deviceId').notEmpty().isString(), validate],
  devicesController.getDeviceSchedules
);

// ESP32 busca comandos pendentes (rota publica)
router.get(
  '/:deviceId/commands',
  [param('deviceId').notEmpty().isString(), validate],
  devicesController.getDeviceCommands
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

// Toggle power save mode
router.put(
  '/:id/power-save',
  [
    param('id').isInt(),
    body('enabled').isBoolean(),
    validate,
  ],
  devicesController.updatePowerSave
);

module.exports = router;
