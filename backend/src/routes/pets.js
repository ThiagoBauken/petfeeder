const express = require('express');
const { body, param } = require('express-validator');
const petsController = require('../controllers/petsController');
const { verifyToken } = require('../middlewares/auth');
const { validate, apiLimiter } = require('../middlewares');

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Get all pets
router.get('/', apiLimiter, petsController.getPets);

// Get single pet
router.get(
  '/:id',
  [param('id').isInt(), validate],
  petsController.getPet
);

// Create pet
router.post(
  '/',
  [
    body('device_id').isInt(),
    body('name').notEmpty().trim(),
    body('type').isIn(['cat', 'dog', 'other']),
    body('breed').optional().isString().trim(),
    body('color').optional().isString().trim(),
    body('weight').optional().isFloat({ min: 0 }),
    body('birth_date').optional().isDate(),
    body('daily_amount').optional().isInt({ min: 0 }),
    body('compartment').isInt({ min: 1, max: 3 }),
    validate,
  ],
  petsController.createPet
);

// Update pet
router.put(
  '/:id',
  [
    param('id').isInt(),
    body('name').optional().trim(),
    body('type').optional().isIn(['cat', 'dog', 'other']),
    body('breed').optional().isString().trim(),
    body('color').optional().isString().trim(),
    body('weight').optional().isFloat({ min: 0 }),
    body('birth_date').optional().isDate(),
    body('daily_amount').optional().isInt({ min: 0 }),
    body('compartment').optional().isInt({ min: 1, max: 3 }),
    validate,
  ],
  petsController.updatePet
);

// Delete pet
router.delete(
  '/:id',
  [param('id').isInt(), validate],
  petsController.deletePet
);

// Get pet statistics
router.get(
  '/:id/statistics',
  [param('id').isInt(), validate],
  petsController.getPetStatistics
);

module.exports = router;
