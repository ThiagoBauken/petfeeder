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

  // ==================== ROTAS ESP32 (PUBLICAS) ====================

  // Auto-registro do ESP32 usando email do usuario
  async autoRegisterDevice(req, res, next) {
    try {
      const { deviceId, email, name } = req.body;

      logger.info('Auto-register attempt', { deviceId, email });

      // Buscar usuario pelo email
      const userResult = await query(
        'SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Email não encontrado. Crie uma conta primeiro no site.',
        });
      }

      const user = userResult.rows[0];
      const deviceName = name || `PetFeeder ${deviceId.slice(-6)}`;

      // Verificar se dispositivo ja existe
      const existingDevice = await query(
        'SELECT id FROM devices WHERE device_id = $1',
        [deviceId]
      );

      if (existingDevice.rows.length > 0) {
        // Atualizar dispositivo existente
        await query(
          `UPDATE devices SET user_id = $1, name = $2, status = 'online', last_seen_at = NOW(), updated_at = NOW()
           WHERE device_id = $3`,
          [user.id, deviceName, deviceId]
        );
        logger.info('Device re-linked', { deviceId, userId: user.id });
      } else {
        // Criar novo dispositivo
        await query(
          `INSERT INTO devices (device_id, user_id, name, status, activated_at)
           VALUES ($1, $2, $3, 'online', NOW())`,
          [deviceId, user.id, deviceName]
        );
        logger.info('Device created', { deviceId, userId: user.id });
      }

      // Salvar status no Redis
      await redis.set(`device:${deviceId}:status`, {
        online: true,
        timestamp: new Date().toISOString(),
      }, 600);

      res.json({
        success: true,
        message: 'Dispositivo vinculado com sucesso',
      });
    } catch (error) {
      logger.error('Auto-register error', error);
      next(error);
    }
  }

  // ESP32 envia status do dispositivo
  async updateDeviceStatus(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { food_level, rssi, ip, mode, power_save_enabled, schedules_count } = req.body;

      logger.info('Device status update', { deviceId, food_level, mode });

      // Atualizar no banco
      await query(
        `UPDATE devices SET
           status = 'online',
           food_level = COALESCE($1, food_level),
           ip_address = COALESCE($2, ip_address),
           last_seen_at = NOW(),
           updated_at = NOW()
         WHERE device_id = $3`,
        [food_level, ip, deviceId]
      );

      // Salvar status detalhado no Redis
      await redis.set(`device:${deviceId}:status`, {
        online: true,
        food_level,
        rssi,
        ip,
        mode,
        power_save_enabled,
        schedules_count,
        timestamp: new Date().toISOString(),
      }, 600);

      // Notificar via WebSocket (se disponivel)
      const device = await query(
        'SELECT user_id FROM devices WHERE device_id = $1',
        [deviceId]
      );

      if (device.rows.length > 0) {
        const websocketService = require('../services/websocketService');
        websocketService.sendToUser(device.rows[0].user_id, {
          type: 'device_status',
          data: { device_id: deviceId, food_level, mode, online: true },
        });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Update device status error', error);
      next(error);
    }
  }

  // ESP32 busca horarios agendados
  async getDeviceSchedules(req, res, next) {
    try {
      const { deviceId } = req.params;

      logger.info('Device fetching schedules', { deviceId });

      // Buscar dispositivo e power_save
      const deviceResult = await query(
        'SELECT id, user_id, power_save FROM devices WHERE device_id = $1 AND deleted_at IS NULL',
        [deviceId]
      );

      if (deviceResult.rows.length === 0) {
        return res.json({ success: true, data: [], power_save: false });
      }

      const device = deviceResult.rows[0];

      // Buscar horarios ativos do usuario
      const schedulesResult = await query(
        `SELECT s.hour, s.minute, s.amount, s.active,
                s.monday, s.tuesday, s.wednesday, s.thursday, s.friday, s.saturday, s.sunday,
                p.name as pet_name
         FROM schedules s
         JOIN pets p ON p.id = s.pet_id
         JOIN devices d ON d.id = s.device_id
         WHERE d.user_id = $1 AND s.active = true AND s.deleted_at IS NULL
         ORDER BY s.hour, s.minute`,
        [device.user_id]
      );

      // Formatar para o ESP32
      const formatted = schedulesResult.rows.map(s => {
        // Converter amount para size
        let size = 'medium';
        if (s.amount <= 50) size = 'small';
        else if (s.amount > 100) size = 'large';

        // Converter dias da semana para array
        const daysArray = [];
        if (s.sunday) daysArray.push(0);
        if (s.monday) daysArray.push(1);
        if (s.tuesday) daysArray.push(2);
        if (s.wednesday) daysArray.push(3);
        if (s.thursday) daysArray.push(4);
        if (s.friday) daysArray.push(5);
        if (s.saturday) daysArray.push(6);

        return {
          hour: s.hour,
          minute: s.minute,
          size,
          days: daysArray.length > 0 ? daysArray : [0, 1, 2, 3, 4, 5, 6],
          active: true,
          pet: s.pet_name || 'Pet',
        };
      });

      // Atualizar last_seen
      await query(
        "UPDATE devices SET last_seen_at = NOW(), status = 'online' WHERE device_id = $1",
        [deviceId]
      );

      res.json({
        success: true,
        data: formatted,
        power_save: device.power_save || false,
      });
    } catch (error) {
      logger.error('Get device schedules error', error);
      next(error);
    }
  }

  // ESP32 busca comandos pendentes
  async getDeviceCommands(req, res, next) {
    try {
      const { deviceId } = req.params;

      // Atualizar last_seen
      await query(
        "UPDATE devices SET last_seen_at = NOW(), status = 'online' WHERE device_id = $1",
        [deviceId]
      );

      // Buscar comandos pendentes do Redis
      const commandsKey = `device:${deviceId}:commands`;
      const commands = await redis.get(commandsKey);

      if (commands && commands.length > 0) {
        // Pegar primeiro comando e remover da fila
        const cmd = commands.shift();
        if (commands.length > 0) {
          await redis.set(commandsKey, commands, 3600);
        } else {
          await redis.del(commandsKey);
        }

        logger.info('Command sent to device', { deviceId, command: cmd });
        return res.json(cmd);
      }

      res.json({}); // Nenhum comando pendente
    } catch (error) {
      logger.error('Get device commands error', error);
      next(error);
    }
  }

  // Toggle power save mode
  async updatePowerSave(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { enabled } = req.body;

      const result = await query(
        `UPDATE devices SET power_save = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
         RETURNING device_id`,
        [enabled, id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Device not found',
        });
      }

      const deviceId = result.rows[0].device_id;

      // Adicionar comando sync para ESP32 buscar nova config
      const commandsKey = `device:${deviceId}:commands`;
      const commands = await redis.get(commandsKey) || [];
      commands.push({ command: 'sync' });
      await redis.set(commandsKey, commands, 3600);

      logger.info('Power save updated', { deviceId, enabled });

      res.json({
        success: true,
        message: `Modo economia ${enabled ? 'ativado' : 'desativado'}`,
        power_save: enabled,
      });
    } catch (error) {
      logger.error('Update power save error', error);
      next(error);
    }
  }
}

module.exports = new DevicesController();
