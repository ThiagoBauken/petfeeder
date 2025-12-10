const { query } = require('../config/database');
const mqttService = require('../services/mqttService');
const websocketService = require('../services/websocketService');
const logger = require('../utils/logger');

class FeedController {
  // Manual feed
  async feedNow(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, pet_id, amount } = req.body;

      // Verify device ownership
      const device = await query(
        'SELECT id, device_id FROM devices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [device_id, userId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      // Verify pet ownership and get compartment
      const pet = await query(
        'SELECT id, name, compartment FROM pets WHERE id = $1 AND device_id = $2 AND deleted_at IS NULL',
        [pet_id, device_id]
      );

      if (pet.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pet not found',
        });
      }

      const petData = pet.rows[0];
      const deviceId = device.rows[0].device_id;

      // Send feed command via MQTT
      const sent = mqttService.sendCommand(deviceId, 'feed', {
        pet_id: pet_id,
        compartment: petData.compartment,
        amount: amount,
        trigger: 'manual',
      });

      if (!sent) {
        return res.status(503).json({
          success: false,
          message: 'Failed to send command (device offline)',
        });
      }

      // Record feeding event
      const feeding = await query(
        `INSERT INTO feedings (device_id, pet_id, amount, trigger, status)
         VALUES ($1, $2, $3, 'manual', 'pending')
         RETURNING *`,
        [device_id, pet_id, amount]
      );

      // Notify via WebSocket
      websocketService.notifyFeeding(deviceId, {
        pet_id: pet_id,
        pet_name: petData.name,
        amount: amount,
        trigger: 'manual',
      });

      logger.info('Manual feeding initiated', { userId, deviceId, petId: pet_id, amount });

      res.json({
        success: true,
        message: 'Feeding command sent',
        data: feeding.rows[0],
      });
    } catch (error) {
      logger.error('Feed now error', error);
      next(error);
    }
  }

  // Get feeding history
  async getHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, pet_id, days } = req.query;
      const daysAgo = parseInt(days) || 7;

      let queryText = `
        SELECT f.*,
               p.name as pet_name,
               d.name as device_name,
               d.device_id
        FROM feedings f
        JOIN devices d ON d.id = f.device_id
        LEFT JOIN pets p ON p.id = f.pet_id
        WHERE d.user_id = $1
          AND f.timestamp >= NOW() - INTERVAL '${daysAgo} days'
      `;

      const params = [userId];
      let paramCount = 1;

      if (device_id) {
        paramCount++;
        queryText += ` AND f.device_id = $${paramCount}`;
        params.push(device_id);
      }

      if (pet_id) {
        paramCount++;
        queryText += ` AND f.pet_id = $${paramCount}`;
        params.push(pet_id);
      }

      queryText += ' ORDER BY f.timestamp DESC LIMIT $' + (paramCount + 1);
      params.push(req.pagination?.limit || 100);

      const result = await query(queryText, params);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Get feeding history error', error);
      next(error);
    }
  }

  // Get feeding statistics
  async getStatistics(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, days } = req.query;
      const daysAgo = parseInt(days) || 30;

      let whereClause = 'd.user_id = $1 AND f.timestamp >= NOW() - INTERVAL \'' + daysAgo + ' days\'';
      const params = [userId];

      if (device_id) {
        whereClause += ' AND f.device_id = $2';
        params.push(device_id);
      }

      // Daily statistics
      const dailyStats = await query(
        `SELECT
           DATE(f.timestamp) as date,
           COUNT(*) as total_feedings,
           SUM(amount) as total_amount,
           COUNT(DISTINCT f.pet_id) as pets_fed
         FROM feedings f
         JOIN devices d ON d.id = f.device_id
         WHERE ${whereClause}
           AND f.status = 'success'
         GROUP BY DATE(f.timestamp)
         ORDER BY date DESC`,
        params
      );

      // Per pet statistics
      const petStats = await query(
        `SELECT
           p.id,
           p.name,
           COUNT(*) as total_feedings,
           SUM(f.amount) as total_amount,
           AVG(f.amount) as avg_amount
         FROM feedings f
         JOIN devices d ON d.id = f.device_id
         JOIN pets p ON p.id = f.pet_id
         WHERE ${whereClause}
           AND f.status = 'success'
         GROUP BY p.id, p.name
         ORDER BY total_feedings DESC`,
        params
      );

      // Trigger breakdown
      const triggerStats = await query(
        `SELECT
           f.trigger,
           COUNT(*) as count,
           SUM(amount) as total_amount
         FROM feedings f
         JOIN devices d ON d.id = f.device_id
         WHERE ${whereClause}
           AND f.status = 'success'
         GROUP BY f.trigger`,
        params
      );

      res.json({
        success: true,
        data: {
          daily: dailyStats.rows,
          per_pet: petStats.rows,
          by_trigger: triggerStats.rows,
          period_days: daysAgo,
        },
      });
    } catch (error) {
      logger.error('Get feeding statistics error', error);
      next(error);
    }
  }

  // ==================== ROTAS ESP32 (PUBLICAS) ====================

  // ESP32 registra alimentacao realizada
  async logFeeding(req, res, next) {
    try {
      const { device_id, size, trigger, food_level_after, pet_name } = req.body;

      logger.info('Feeding log received', { device_id, size, pet_name });

      // Buscar dispositivo
      const deviceResult = await query(
        'SELECT id, user_id FROM devices WHERE device_id = $1',
        [device_id]
      );

      if (deviceResult.rows.length === 0) {
        logger.warn('Device not found for feeding log', { device_id });
        return res.json({ success: false, message: 'Dispositivo não encontrado' });
      }

      const device = deviceResult.rows[0];

      // Converter size para amount
      const amounts = { small: 50, medium: 100, large: 150 };
      const amount = amounts[size] || 100;

      // Buscar pet pelo nome ou pelo device_id
      let petQuery, petParams;
      if (pet_name) {
        petQuery = 'SELECT id, name FROM pets WHERE name = $1 AND user_id = $2 AND deleted_at IS NULL';
        petParams = [pet_name, device.user_id];
      } else {
        petQuery = 'SELECT id, name FROM pets WHERE device_id = $1 AND deleted_at IS NULL LIMIT 1';
        petParams = [device.id];
      }

      const petResult = await query(petQuery, petParams);

      if (petResult.rows.length === 0) {
        logger.warn('Pet not found for feeding log', { device_id, pet_name });
        return res.json({ success: true, message: 'Pet não encontrado, histórico não registrado' });
      }

      const pet = petResult.rows[0];

      // Registrar no histórico
      await query(
        `INSERT INTO feedings (device_id, pet_id, amount, trigger, status, timestamp)
         VALUES ($1, $2, $3, $4, 'success', NOW())`,
        [device.id, pet.id, amount, trigger || 'scheduled']
      );

      // Atualizar food_level do dispositivo
      if (food_level_after !== undefined) {
        await query(
          'UPDATE devices SET food_level = $1 WHERE id = $2',
          [food_level_after, device.id]
        );
      }

      // Notificar via WebSocket
      websocketService.sendToUser(device.user_id, {
        type: 'feeding_complete',
        data: {
          pet_name: pet.name,
          amount,
          size,
          timestamp: new Date().toISOString(),
        },
      });

      logger.info('Feeding logged', { device_id, pet_name: pet.name, amount });

      res.json({ success: true });
    } catch (error) {
      logger.error('Log feeding error', error);
      next(error);
    }
  }

  // ==================== ROTAS AUTENTICADAS ====================

  // Create schedule
  async createSchedule(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, pet_id, hour, minute, amount, active, weekdays } = req.body;

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

      // Check schedule limits
      const scheduleCount = await query(
        `SELECT COUNT(*) as count
         FROM schedules s
         JOIN devices d ON d.id = s.device_id
         WHERE d.user_id = $1 AND s.deleted_at IS NULL`,
        [userId]
      );

      const plan = req.user.plan;
      const maxSchedules = {
        free: 3,
        basic: 10,
        premium: 50,
      }[plan] || 3;

      if (parseInt(scheduleCount.rows[0].count) >= maxSchedules) {
        return res.status(403).json({
          success: false,
          message: `Schedule limit reached for ${plan} plan`,
          limit: maxSchedules,
        });
      }

      // Create schedule
      const result = await query(
        `INSERT INTO schedules (device_id, pet_id, hour, minute, amount, active, monday, tuesday, wednesday, thursday, friday, saturday, sunday)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          device_id,
          pet_id,
          hour,
          minute,
          amount,
          active !== false,
          weekdays?.monday !== false,
          weekdays?.tuesday !== false,
          weekdays?.wednesday !== false,
          weekdays?.thursday !== false,
          weekdays?.friday !== false,
          weekdays?.saturday !== false,
          weekdays?.sunday !== false,
        ]
      );

      logger.info('Schedule created', { userId, scheduleId: result.rows[0].id });

      res.status(201).json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Create schedule error', error);
      next(error);
    }
  }

  // Get schedules
  async getSchedules(req, res, next) {
    try {
      const userId = req.user.id;
      const { device_id, pet_id } = req.query;

      let queryText = `
        SELECT s.*,
               p.name as pet_name,
               d.name as device_name
        FROM schedules s
        JOIN devices d ON d.id = s.device_id
        LEFT JOIN pets p ON p.id = s.pet_id
        WHERE d.user_id = $1 AND s.deleted_at IS NULL
      `;

      const params = [userId];
      let paramCount = 1;

      if (device_id) {
        paramCount++;
        queryText += ` AND s.device_id = $${paramCount}`;
        params.push(device_id);
      }

      if (pet_id) {
        paramCount++;
        queryText += ` AND s.pet_id = $${paramCount}`;
        params.push(pet_id);
      }

      queryText += ' ORDER BY s.hour, s.minute';

      const result = await query(queryText, params);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Get schedules error', error);
      next(error);
    }
  }

  // Update schedule
  async updateSchedule(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { hour, minute, amount, active, weekdays } = req.body;

      const result = await query(
        `UPDATE schedules s
         SET hour = COALESCE($1, s.hour),
             minute = COALESCE($2, s.minute),
             amount = COALESCE($3, s.amount),
             active = COALESCE($4, s.active),
             monday = COALESCE($5, s.monday),
             tuesday = COALESCE($6, s.tuesday),
             wednesday = COALESCE($7, s.wednesday),
             thursday = COALESCE($8, s.thursday),
             friday = COALESCE($9, s.friday),
             saturday = COALESCE($10, s.saturday),
             sunday = COALESCE($11, s.sunday),
             updated_at = NOW()
         FROM devices d
         WHERE s.id = $12
           AND s.device_id = d.id
           AND d.user_id = $13
           AND s.deleted_at IS NULL
         RETURNING s.*`,
        [
          hour,
          minute,
          amount,
          active,
          weekdays?.monday,
          weekdays?.tuesday,
          weekdays?.wednesday,
          weekdays?.thursday,
          weekdays?.friday,
          weekdays?.saturday,
          weekdays?.sunday,
          id,
          userId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Schedule not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Update schedule error', error);
      next(error);
    }
  }

  // Delete schedule
  async deleteSchedule(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const result = await query(
        `UPDATE schedules s
         SET deleted_at = NOW()
         FROM devices d
         WHERE s.id = $1
           AND s.device_id = d.id
           AND d.user_id = $2
           AND s.deleted_at IS NULL
         RETURNING s.id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Schedule not found',
        });
      }

      logger.info('Schedule deleted', { userId, scheduleId: id });

      res.json({
        success: true,
        message: 'Schedule deleted successfully',
      });
    } catch (error) {
      logger.error('Delete schedule error', error);
      next(error);
    }
  }
}

module.exports = new FeedController();
