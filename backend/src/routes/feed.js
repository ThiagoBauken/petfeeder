const express = require('express');
const { body, param } = require('express-validator');
const feedController = require('../controllers/feedController');
const { verifyToken } = require('../middlewares/auth');
const { validate, apiLimiter } = require('../middlewares');

const router = express.Router();

// ==================== ROTAS PUBLICAS (ESP32) ====================

// ESP32 registra alimentacao realizada
router.post(
  '/log',
  [
    body('device_id').notEmpty().isString(),
    body('size').isIn(['small', 'medium', 'large']),
    body('trigger').optional().isString(),
    body('food_level_after').optional().isInt({ min: 0, max: 100 }),
    body('pet_name').optional().isString(),
    validate,
  ],
  feedController.logFeeding
);

// ==================== ROTAS AUTENTICADAS ====================

// All routes below require authentication
router.use(verifyToken);

// Manual feeding
router.post(
  '/now',
  [
    body('device_id').isInt(),
    body('pet_id').isInt(),
    body('amount').isInt({ min: 1, max: 500 }),
    validate,
  ],
  feedController.feedNow
);

// Get feeding history
router.get('/history', apiLimiter, feedController.getHistory);

// Get feeding statistics
router.get('/statistics', apiLimiter, feedController.getStatistics);

// Schedules

// Get schedules
router.get('/schedules', apiLimiter, feedController.getSchedules);

// Create schedule
router.post(
  '/schedules',
  [
    body('device_id').isInt(),
    body('pet_id').isInt(),
    body('hour').isInt({ min: 0, max: 23 }),
    body('minute').isInt({ min: 0, max: 59 }),
    body('amount').isInt({ min: 1, max: 500 }),
    body('active').optional().isBoolean(),
    body('weekdays').optional().isObject(),
    validate,
  ],
  feedController.createSchedule
);

// Update schedule
router.put(
  '/schedules/:id',
  [
    param('id').isInt(),
    body('hour').optional().isInt({ min: 0, max: 23 }),
    body('minute').optional().isInt({ min: 0, max: 59 }),
    body('amount').optional().isInt({ min: 1, max: 500 }),
    body('active').optional().isBoolean(),
    body('weekdays').optional().isObject(),
    validate,
  ],
  feedController.updateSchedule
);

// Delete schedule
router.delete(
  '/schedules/:id',
  [param('id').isInt(), validate],
  feedController.deleteSchedule
);

module.exports = router;
