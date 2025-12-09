const { query } = require('../config/database');
const { redis } = require('../config/redis');
const mqttService = require('../services/mqttService');
const config = require('../config');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class DevicesController {
  // ==================== REGISTRO DO ESP32 ====================

  // Registro inicial do dispositivo ESP32 (rota publica)
  // O ESP32 envia: deviceId, userToken, deviceType, firmware, mac, ip
  async registerDevice(req, res, next) {
    try {
      const { deviceId, userToken, deviceType, firmware, mac, ip } = req.body;

      logger.info('Device registration attempt', { deviceId, mac });

      // Validar token do usuario
      const userResult = await query(
        `SELECT id, email, name, plan FROM users
         WHERE id = $1 AND deleted_at IS NULL`,
        [userToken]
      );

      if (userResult.rows.length === 0) {
        // Tenta buscar por token de API
        const apiKeyResult = await query(
          `SELECT u.id, u.email, u.name, u.plan
           FROM users u
           JOIN api_keys ak ON ak.user_id = u.id
           WHERE ak.key_hash = $1 AND ak.active = true`,
          [userToken]
        );

        if (apiKeyResult.rows.length === 0) {
          return res.status(401).json({
            success: false,
            message: 'Invalid user token',
          });
        }
      }

      const user = userResult.rows[0] || apiKeyResult?.rows[0];
      const userId = user.id;

      // Verificar limite de dispositivos
      const deviceCount = await query(
        'SELECT COUNT(*) as count FROM devices WHERE user_id = $1 AND deleted_at IS NULL',
        [userId]
      );

      const planLimits = { free: 1, basic: 3, premium: 10, enterprise: 999 };
      const maxDevices = planLimits[user.plan] || 1;

      if (parseInt(deviceCount.rows[0].count) >= maxDevices) {
        return res.status(403).json({
          success: false,
          message: 'Device limit reached for your plan',
          limit: maxDevices,
        });
      }

      // Gerar credenciais MQTT
      const mqttUser = `device_${deviceId}`;
      const mqttPass = uuidv4();
      const authToken = uuidv4();

      // Registrar ou atualizar dispositivo
      const result = await query(
        `INSERT INTO devices (
           device_id, user_id, name, device_type, firmware_version,
           mac_address, ip_address, mqtt_username, mqtt_password,
           auth_token, status, activated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'online', NOW())
         ON CONFLICT (device_id)
         DO UPDATE SET
           user_id = $2,
           firmware_version = $5,
           mac_address = $6,
           ip_address = $7,
           mqtt_username = $8,
           mqtt_password = $9,
           auth_token = $10,
           status = 'online',
           last_seen_at = NOW(),
           updated_at = NOW()
         RETURNING *`,
        [
          deviceId,
          userId,
          `PetFeeder ${deviceId.slice(-6)}`,
          deviceType || 'PETFEEDER_V1',
          firmware || '1.0.0',
          mac,
          ip,
          mqttUser,
          mqttPass,
          authToken,
        ]
      );

      // Salvar info no Redis
      await redis.set(`device:${deviceId}:info`, {
        deviceId,
        userId,
        firmwareVersion: firmware,
        macAddress: mac,
        registeredAt: new Date().toISOString(),
      });

      await redis.set(`device:${deviceId}:status`, {
        online: true,
        timestamp: new Date().toISOString(),
      }, 300);

      logger.info('Device registered successfully', { deviceId, userId });

      // Retornar credenciais para o ESP32
      res.status(201).json({
        success: true,
        message: 'Device registered successfully',
        mqttUser,
        mqttPass,
        authToken,
        userId,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Device registration error', error);
      next(error);
    }
  }

  // Get all user devices
  async getDevices(req, res, next) {
    try {
      const userId = req.user.id;

      const result = await query(
        `SELECT d.*,
                COUNT(p.id) as pet_count
         FROM devices d
         LEFT JOIN pets p ON p.device_id = d.id AND p.deleted_at IS NULL
         WHERE d.user_id = $1 AND d.deleted_at IS NULL
         GROUP BY d.id
         ORDER BY d.created_at DESC`,
        [userId]
      );

      // Get online status from Redis
      for (const device of result.rows) {
        const status = await redis.get(`device:${device.device_id}:status`);
        device.online = status?.online || false;
        device.last_seen = status?.timestamp;
      }

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Get devices error', error);
      next(error);
    }
  }

  // Get single device
  async getDevice(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const result = await query(
        `SELECT d.*,
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'name', p.name,
                    'type', p.type,
                    'daily_amount', p.daily_amount
                  )
                ) FILTER (WHERE p.id IS NOT NULL) as pets
         FROM devices d
         LEFT JOIN pets p ON p.device_id = d.id AND p.deleted_at IS NULL
         WHERE d.id = $1 AND d.user_id = $2 AND d.deleted_at IS NULL
         GROUP BY d.id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      const device = result.rows[0];

      // Get device status from Redis
      const status = await redis.get(`device:${device.device_id}:status`);
      device.online = status?.online || false;
      device.wifi_rssi = status?.wifi_rssi;
      device.free_heap = status?.free_heap;
      device.uptime = status?.uptime;
      device.last_seen = status?.timestamp;

      res.json({
        success: true,
        data: device,
      });
    } catch (error) {
      logger.error('Get device error', error);
      next(error);
    }
  }

  // Link device to user account
  async linkDevice(req, res, next) {
    try {
      const userId = req.user.id;
      const { deviceId, name } = req.body;

      // Check device limits based on plan
      const deviceCount = await query(
        'SELECT COUNT(*) as count FROM devices WHERE user_id = $1 AND deleted_at IS NULL',
        [userId]
      );

      const plan = req.user.plan;
      const maxDevices = config.limits.devices[plan] || config.limits.devices.free;

      if (parseInt(deviceCount.rows[0].count) >= maxDevices) {
        return res.status(403).json({
          success: false,
          message: `Device limit reached for ${plan} plan`,
          limit: maxDevices,
        });
      }

      // Check if device exists and is not already linked
      const existingDevice = await query(
        'SELECT id, user_id FROM devices WHERE device_id = $1',
        [deviceId]
      );

      if (existingDevice.rows.length > 0) {
        if (existingDevice.rows[0].user_id) {
          return res.status(400).json({
            success: false,
            message: 'Device already linked to another account',
          });
        }
      }

      // Get device info from Redis (from ESP32 registration)
      const deviceInfo = await redis.get(`device:${deviceId}:info`);
      if (!deviceInfo) {
        return res.status(404).json({
          success: false,
          message: 'Device not found or not registered',
        });
      }

      // Generate auth token for device
      const authToken = uuidv4();

      // Link device
      const result = await query(
        `INSERT INTO devices (device_id, user_id, name, firmware_version, auth_token, status)
         VALUES ($1, $2, $3, $4, $5, 'online')
         ON CONFLICT (device_id)
         DO UPDATE SET
           user_id = $2,
           name = $3,
           auth_token = $5,
           updated_at = NOW()
         RETURNING *`,
        [deviceId, userId, name || `Device ${deviceId.slice(-6)}`, deviceInfo.firmwareVersion, authToken]
      );

      // Send configuration to device via MQTT
      mqttService.sendConfig(deviceId, {
        auth_token: authToken,
        user_id: userId,
        linked: true,
      });

      logger.info('Device linked', { userId, deviceId });

      res.status(201).json({
        success: true,
        message: 'Device linked successfully',
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Link device error', error);
      next(error);
    }
  }

  // Update device
  async updateDevice(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { name, location, timezone } = req.body;

      const result = await query(
        `UPDATE devices
         SET name = COALESCE($1, name),
             location = COALESCE($2, location),
             timezone = COALESCE($3, timezone),
             updated_at = NOW()
         WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL
         RETURNING *`,
        [name, location, timezone, id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Update device error', error);
      next(error);
    }
  }

  // Delete device
  async deleteDevice(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // Soft delete
      const result = await query(
        `UPDATE devices
         SET deleted_at = NOW(), user_id = NULL
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING device_id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      // Notify device via MQTT
      const deviceId = result.rows[0].device_id;
      mqttService.sendCommand(deviceId, 'unlink', {
        message: 'Device has been unlinked from account',
      });

      logger.info('Device deleted', { userId, deviceId });

      res.json({
        success: true,
        message: 'Device deleted successfully',
      });
    } catch (error) {
      logger.error('Delete device error', error);
      next(error);
    }
  }

  // Send command to device
  async sendCommand(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { command, data } = req.body;

      // Verify device ownership
      const device = await query(
        'SELECT device_id FROM devices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, userId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      const deviceId = device.rows[0].device_id;

      // Send command via MQTT
      const sent = mqttService.sendCommand(deviceId, command, data);

      if (!sent) {
        return res.status(503).json({
          success: false,
          message: 'Failed to send command (MQTT offline)',
        });
      }

      logger.info('Command sent to device', { userId, deviceId, command });

      res.json({
        success: true,
        message: 'Command sent successfully',
      });
    } catch (error) {
      logger.error('Send command error', error);
      next(error);
    }
  }

  // Get device telemetry
  async getTelemetry(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const limit = parseInt(req.query.limit) || 100;

      // Verify device ownership
      const device = await query(
        'SELECT device_id FROM devices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, userId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      const deviceId = device.rows[0].device_id;

      // Get telemetry from Redis
      const telemetry = await mqttService.getDeviceTelemetry(deviceId, limit);

      res.json({
        success: true,
        data: telemetry,
      });
    } catch (error) {
      logger.error('Get telemetry error', error);
      next(error);
    }
  }

  // Restart device
  async restartDevice(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      // Verify device ownership
      const device = await query(
        'SELECT device_id FROM devices WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, userId]
      );

      if (device.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      const deviceId = device.rows[0].device_id;

      // Send restart command
      mqttService.sendCommand(deviceId, 'restart');

      logger.info('Device restart requested', { userId, deviceId });

      res.json({
        success: true,
        message: 'Restart command sent',
      });
    } catch (error) {
      logger.error('Restart device error', error);
      next(error);
    }
  }
}

module.exports = new DevicesController();
