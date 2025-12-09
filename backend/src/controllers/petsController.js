const { query } = require('../config/database');
const logger = require('../utils/logger');
const config = require('../config');

class PetsController {
  // Get all pets for user
  async getPets(req, res, next) {
    try {
      const userId = req.user.id;

      const result = await query(
        `SELECT p.*,
                d.name as device_name,
                d.device_id
         FROM pets p
         JOIN devices d ON d.id = p.device_id
         WHERE d.user_id = $1 AND p.deleted_at IS NULL AND d.deleted_at IS NULL
         ORDER BY p.created_at DESC`,
        [userId]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Get pets error', error);
      next(error);
    }
  }

  // Get single pet
  async getPet(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const result = await query(
        `SELECT p.*,
                d.name as device_name,
                d.device_id
         FROM pets p
         JOIN devices d ON d.id = p.device_id
         WHERE p.id = $1 AND d.user_id = $2 AND p.deleted_at IS NULL AND d.deleted_at IS NULL`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pet not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Get pet error', error);
      next(error);
    }
  }

  // Create pet
  async createPet(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, name, type, breed, color, weight, birth_date, daily_amount, compartment } = req.body;

      // Verify device ownership
      const device = await query(
        'SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [device_id, userId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      // Check pet limit per device
      const petCount = await query(
        'SELECT COUNT(*) as count FROM pets WHERE device_id = $1 AND deleted_at IS NULL',
        [device_id]
      );

      if (parseInt(petCount.rows[0].count) >= config.limits.petsPerDevice) {
        return res.status(403).json({
          success: false,
          message: `Maximum ${config.limits.petsPerDevice} pets per device`,
        });
      }

      // Create pet
      const result = await query(
        `INSERT INTO pets (device_id, name, type, breed, color, weight, birth_date, daily_amount, compartment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [device_id, name, type, breed, color, weight, birth_date, daily_amount, compartment]
      );

      logger.info('Pet created', { userId, petId: result.rows[0].id, name });

      res.status(201).json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Create pet error', error);
      next(error);
    }
  }

  // Update pet
  async updatePet(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { name, type, breed, color, weight, birth_date, daily_amount, compartment } = req.body;

      const result = await query(
        `UPDATE pets p
         SET name = COALESCE($1, p.name),
             type = COALESCE($2, p.type),
             breed = COALESCE($3, p.breed),
             color = COALESCE($4, p.color),
             weight = COALESCE($5, p.weight),
             birth_date = COALESCE($6, p.birth_date),
             daily_amount = COALESCE($7, p.daily_amount),
             compartment = COALESCE($8, p.compartment),
             updated_at = NOW()
         FROM devices d
         WHERE p.id = $9
           AND p.device_id = d.id
           AND d.user_id = $10
           AND p.deleted_at IS NULL
           AND d.deleted_at IS NULL
         RETURNING p.*`,
        [name, type, breed, color, weight, birth_date, daily_amount, compartment, id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pet not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Update pet error', error);
      next(error);
    }
  }

  // Delete pet
  async deletePet(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const result = await query(
        `UPDATE pets p
         SET deleted_at = NOW()
         FROM devices d
         WHERE p.id = $1
           AND p.device_id = d.id
           AND d.user_id = $2
           AND p.deleted_at IS NULL
         RETURNING p.id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pet not found',
        });
      }

      logger.info('Pet deleted', { userId, petId: id });

      res.json({
        success: true,
        message: 'Pet deleted successfully',
      });
    } catch (error) {
      logger.error('Delete pet error', error);
      next(error);
    }
  }

  // Get pet statistics
  async getPetStatistics(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { days } = req.query;
      const daysAgo = parseInt(days) || 30;

      // Get feeding stats
      const stats = await query(
        `SELECT
           COUNT(*) as total_feedings,
           SUM(amount) as total_amount,
           AVG(amount) as avg_amount,
           DATE(f.timestamp) as date
         FROM feedings f
         JOIN pets p ON p.id = f.pet_id
         JOIN devices d ON d.id = p.device_id
         WHERE p.id = $1
           AND d.user_id = $2
           AND f.timestamp >= NOW() - INTERVAL '${daysAgo} days'
           AND f.status = 'success'
         GROUP BY DATE(f.timestamp)
         ORDER BY date DESC`,
        [id, userId]
      );

      // Get total stats
      const totals = await query(
        `SELECT
           COUNT(*) as total_feedings,
           SUM(amount) as total_amount,
           AVG(amount) as avg_amount
         FROM feedings f
         JOIN pets p ON p.id = f.pet_id
         JOIN devices d ON d.id = p.device_id
         WHERE p.id = $1
           AND d.user_id = $2
           AND f.timestamp >= NOW() - INTERVAL '${daysAgo} days'
           AND f.status = 'success'`,
        [id, userId]
      );

      res.json({
        success: true,
        data: {
          daily: stats.rows,
          totals: totals.rows[0],
          period_days: daysAgo,
        },
      });
    } catch (error) {
      logger.error('Get pet statistics error', error);
      next(error);
    }
  }
}

module.exports = new PetsController();
