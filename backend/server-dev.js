/*
 * PetFeeder Backend - Versão de Desenvolvimento (SEM DOCKER)
 *
 * Esta versão roda sem Docker usando:
 * - SQLite em vez de PostgreSQL
 * - Memória em vez de Redis
 * - MQTT simulado (sem Mosquitto)
 *
 * Para produção, use o server.js com Docker!
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { WebSocketServer } = require('ws');

// ========================================
// CONFIGURAÇÃO
// ========================================

const PORT = 3000;
const WS_PORT = 8081;
const JWT_SECRET = 'dev_secret_min_32_caracteres_para_jwt_token';
const JWT_REFRESH_SECRET = 'dev_refresh_secret_min_32_caracteres_token';

// ========================================
// BANCO DE DADOS SQLite
// ========================================

// Em produção usa arquivo persistente, em dev usa memória
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DB_PATH = IS_PRODUCTION ? '/app/data/petfeeder.db' : ':memory:';

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Erro ao criar banco:', err);
    process.exit(1);
  }
  console.log(`✅ Banco SQLite: ${IS_PRODUCTION ? 'arquivo persistente' : 'memória (dev)'}`);
});

// Criar tabelas (IF NOT EXISTS para produção)
db.serialize(() => {
  // Users
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Devices
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'offline',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Pets
  db.run(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      compartment INTEGER NOT NULL,
      daily_amount REAL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (device_id) REFERENCES devices(id)
    )
  `);

  // Feeding history
  db.run(`
    CREATE TABLE IF NOT EXISTS feeding_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      trigger_type TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (device_id) REFERENCES devices(id)
    )
  `);

  // Schedules
  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      amount REAL NOT NULL,
      days TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (device_id) REFERENCES devices(id)
    )
  `);

  console.log('✅ Tabelas verificadas/criadas');
});

// ========================================
// CACHE EM MEMÓRIA (substitui Redis)
// ========================================

const cache = new Map();

function cacheSet(key, value, ttl = 3600) {
  const expiry = Date.now() + (ttl * 1000);
  cache.set(key, { value, expiry });
}

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

// ========================================
// EXPRESS APP
// ========================================

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Servir frontend estático
// Em produção: ./public (dentro do container)
// Em dev: ../frontend (pasta local)
const publicPath = IS_PRODUCTION
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'frontend');
app.use(express.static(publicPath));
console.log(`📁 Frontend: ${publicPath}`);

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ========================================
// WEBSOCKET SERVER
// ========================================

const wss = new WebSocketServer({ port: WS_PORT });
const wsClients = new Map();

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket cliente conectado');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'auth' && data.token) {
        try {
          const decoded = jwt.verify(data.token, JWT_SECRET);
          wsClients.set(decoded.userId, ws);
          ws.send(JSON.stringify({ type: 'auth', status: 'success' }));
          console.log(`✅ WebSocket autenticado: user ${decoded.userId}`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Token inválido' }));
        }
      }
    } catch (err) {
      console.error('Erro ao processar mensagem WS:', err.message);
    }
  });

  ws.on('close', () => {
    // Remover cliente desconectado
    for (const [userId, client] of wsClients.entries()) {
      if (client === ws) {
        wsClients.delete(userId);
        break;
      }
    }
    console.log('🔌 WebSocket cliente desconectado');
  });
});

// Função para enviar mensagem para usuário
function sendToUser(userId, message) {
  const ws = wsClients.get(userId);
  if (ws && ws.readyState === 1) {  // 1 = OPEN
    ws.send(JSON.stringify(message));
  }
}

// ========================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ========================================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ========================================
// ROTAS DE AUTENTICAÇÃO
// ========================================

// Registrar
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  db.run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, passwordHash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Email já cadastrado' });
        }
        return res.status(500).json({ error: 'Erro ao criar usuário' });
      }

      const userId = this.lastID;
      const accessToken = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });
      const refreshToken = jwt.sign({ userId, email }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: userId, name, email, plan: 'free' }
        }
      });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha obrigatórios' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar usuário' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ userId: user.id, email: user.email }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, plan: 'free' }
      }
    });
  });
});

// Refresh token
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token obrigatório' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    res.status(401).json({ error: 'Refresh token inválido' });
  }
});

// Obter usuario atual
app.get('/api/auth/me', authMiddleware, (req, res) => {
  db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    res.json({ success: true, data: { ...user, plan: 'free' } });
  });
});

// Obter token do dispositivo (para configurar ESP32)
app.get('/api/auth/device-token', authMiddleware, (req, res) => {
  res.json({
    success: true,
    data: {
      deviceToken: req.userId.toString(),
      instructions: [
        '1. Ligue o ESP32',
        '2. Conecte na rede WiFi: PetFeeder_XXXXXX',
        '3. Acesse: http://192.168.4.1',
        '4. Cole este token no campo "Token do Usuario"',
        '5. Preencha os dados do WiFi e clique Salvar',
      ],
    },
  });
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Logout realizado' });
});

// ========================================
// ROTAS DE DISPOSITIVOS
// ========================================

// Registro de ESP32 (rota PUBLICA - sem auth)
app.post('/api/devices/register', (req, res) => {
  const { deviceId, userToken, deviceType, firmware, mac, ip } = req.body;

  if (!deviceId || !userToken) {
    return res.status(400).json({ success: false, message: 'deviceId e userToken obrigatórios' });
  }

  // Verificar se userToken (userId) existe
  db.get('SELECT id, name, email FROM users WHERE id = ?', [userToken], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ success: false, message: 'Token de usuário inválido' });
    }

    // Gerar credenciais MQTT (simulado)
    const mqttUser = `device_${deviceId}`;
    const mqttPass = `mqtt_${Date.now()}`;

    // Registrar dispositivo
    db.run(
      `INSERT INTO devices (user_id, device_id, name, status)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET status = 'online'`,
      [user.id, deviceId, `PetFeeder ${deviceId.slice(-6)}`, 'online'],
      function(err) {
        if (err) {
          console.error('Erro ao registrar dispositivo:', err);
          return res.status(500).json({ success: false, message: 'Erro ao registrar dispositivo' });
        }

        console.log(`✅ ESP32 registrado: ${deviceId} para usuário ${user.email}`);

        res.status(201).json({
          success: true,
          message: 'Device registered successfully',
          mqttUser,
          mqttPass,
          authToken: `auth_${deviceId}`,
          userId: user.id,
          serverTime: new Date().toISOString(),
        });
      }
    );
  });
});

// Listar dispositivos
app.get('/api/devices', authMiddleware, (req, res) => {
  db.all(
    'SELECT * FROM devices WHERE user_id = ?',
    [req.userId],
    (err, devices) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar dispositivos' });
      }
      res.json({ success: true, data: devices });
    }
  );
});

// Vincular dispositivo
app.post('/api/devices/link', authMiddleware, (req, res) => {
  const { deviceId, name } = req.body;

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'deviceId obrigatório' });
  }

  const deviceName = name || `PetFeeder ${deviceId.slice(-6)}`;

  db.run(
    'INSERT INTO devices (user_id, device_id, name, status) VALUES (?, ?, ?, ?)',
    [req.userId, deviceId, deviceName, 'online'],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ success: false, message: 'Dispositivo já vinculado' });
        }
        return res.status(500).json({ success: false, message: 'Erro ao vincular dispositivo' });
      }

      res.json({
        success: true,
        data: {
          id: this.lastID,
          device_id: deviceId,
          name: deviceName,
          status: 'online'
        }
      });
    }
  );
});

// ========================================
// ROTAS DE PETS
// ========================================

// Listar pets
app.get('/api/pets', authMiddleware, (req, res) => {
  db.all(
    `SELECT p.*, d.name as device_name, d.device_id
     FROM pets p
     JOIN devices d ON p.device_id = d.id
     WHERE p.user_id = ?`,
    [req.userId],
    (err, pets) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar pets' });
      }
      res.json({ success: true, data: pets || [] });
    }
  );
});

// Adicionar pet
app.post('/api/pets', authMiddleware, (req, res) => {
  const { name, type, deviceId, compartment, dailyAmount } = req.body;

  if (!name || !deviceId || compartment === undefined) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  // Verificar se dispositivo pertence ao usuário
  db.get(
    'SELECT id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err || !device) {
        return res.status(404).json({ error: 'Dispositivo não encontrado' });
      }

      db.run(
        'INSERT INTO pets (user_id, device_id, name, type, compartment, daily_amount) VALUES (?, ?, ?, ?, ?, ?)',
        [req.userId, deviceId, name, type, compartment, dailyAmount || 100],
        function(err) {
          if (err) {
            return res.status(500).json({ success: false, message: 'Erro ao adicionar pet' });
          }

          res.json({
            success: true,
            data: {
              id: this.lastID,
              name,
              type,
              compartment,
              daily_amount: dailyAmount || 100
            }
          });
        }
      );
    }
  );
});

// ========================================
// ROTAS DE ALIMENTAÇÃO
// ========================================

// Alimentar agora (SIMULADO - sem MQTT)
app.post('/api/feed/now', authMiddleware, (req, res) => {
  const { deviceId, petId, amount } = req.body;

  if (!deviceId || !petId || !amount) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  // Verificar se pet pertence ao usuário
  db.get(
    'SELECT * FROM pets WHERE id = ? AND user_id = ?',
    [petId, req.userId],
    (err, pet) => {
      if (err || !pet) {
        return res.status(404).json({ error: 'Pet não encontrado' });
      }

      // Registrar alimentação
      db.run(
        'INSERT INTO feeding_history (pet_id, device_id, amount, trigger_type) VALUES (?, ?, ?, ?)',
        [petId, deviceId, amount, 'manual'],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Erro ao registrar alimentação' });
          }

          // Enviar via WebSocket
          sendToUser(req.userId, {
            type: 'feeding',
            data: {
              pet_id: petId,
              pet_name: pet.name,
              amount,
              timestamp: new Date().toISOString()
            }
          });

          res.json({
            success: true,
            message: `Alimentação de ${amount}g para ${pet.name} iniciada (SIMULADO)`,
            feedingId: this.lastID
          });
        }
      );
    }
  );
});

// Histórico de alimentação
app.get('/api/feed/history', authMiddleware, (req, res) => {
  db.all(
    `SELECT fh.*, p.name as pet_name, d.name as device_name
     FROM feeding_history fh
     JOIN pets p ON fh.pet_id = p.id
     JOIN devices d ON fh.device_id = d.id
     WHERE p.user_id = ?
     ORDER BY fh.created_at DESC
     LIMIT 50`,
    [req.userId],
    (err, history) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar histórico' });
      }
      res.json({ success: true, data: history || [] });
    }
  );
});

// Alias para /api/feedings (usado pelo frontend)
app.get('/api/feedings', authMiddleware, (req, res) => {
  db.all(
    `SELECT fh.*, p.name as pet_name, d.name as device_name
     FROM feeding_history fh
     JOIN pets p ON fh.pet_id = p.id
     JOIN devices d ON fh.device_id = d.id
     WHERE p.user_id = ?
     ORDER BY fh.created_at DESC
     LIMIT 50`,
    [req.userId],
    (err, history) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar histórico' });
      }
      res.json({ success: true, data: history || [] });
    }
  );
});

// ========================================
// ROTAS DE HORÁRIOS
// ========================================

// Listar horários
app.get('/api/schedules', authMiddleware, (req, res) => {
  db.all(
    `SELECT s.*, p.name as pet_name, d.name as device_name
     FROM schedules s
     JOIN pets p ON s.pet_id = p.id
     JOIN devices d ON s.device_id = d.id
     WHERE p.user_id = ?`,
    [req.userId],
    (err, schedules) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar horários' });
      }

      // Converter days de string para array
      const schedulesFormatted = (schedules || []).map(s => ({
        ...s,
        days: JSON.parse(s.days)
      }));

      res.json({ success: true, data: schedulesFormatted });
    }
  );
});

// Criar horário
app.post('/api/schedules', authMiddleware, (req, res) => {
  const { petId, deviceId, hour, minute, amount, days } = req.body;

  if (petId === undefined || deviceId === undefined || hour === undefined || minute === undefined || !amount || !days) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  // Verificar se pet pertence ao usuário
  db.get(
    'SELECT * FROM pets WHERE id = ? AND user_id = ?',
    [petId, req.userId],
    (err, pet) => {
      if (err || !pet) {
        return res.status(404).json({ error: 'Pet não encontrado' });
      }

      db.run(
        'INSERT INTO schedules (pet_id, device_id, hour, minute, amount, days) VALUES (?, ?, ?, ?, ?, ?)',
        [petId, deviceId, hour, minute, amount, JSON.stringify(days)],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Erro ao criar horário' });
          }

          res.json({
            id: this.lastID,
            pet_id: petId,
            device_id: deviceId,
            hour,
            minute,
            amount,
            days,
            active: true
          });
        }
      );
    }
  );
});

// Deletar horário
app.delete('/api/schedules/:id', authMiddleware, (req, res) => {
  const scheduleId = req.params.id;

  // Verificar se horário pertence ao usuário
  db.get(
    `SELECT s.* FROM schedules s
     JOIN pets p ON s.pet_id = p.id
     WHERE s.id = ? AND p.user_id = ?`,
    [scheduleId, req.userId],
    (err, schedule) => {
      if (err || !schedule) {
        return res.status(404).json({ error: 'Horário não encontrado' });
      }

      db.run('DELETE FROM schedules WHERE id = ?', [scheduleId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao deletar horário' });
        }

        res.json({ success: true, message: 'Horário deletado' });
      });
    }
  );
});

// ========================================
// ROTA DE STATUS
// ========================================

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    mode: 'development',
    database: 'SQLite (in-memory)',
    mqtt: 'Simulado',
    websocket: 'Ativo',
    clients: wsClients.size
  });
});

// ========================================
// ROTAS ESP32 (HTTPS - sem MQTT)
// ========================================

// Fila de comandos pendentes por dispositivo
const deviceCommands = new Map();
const deviceStatus = new Map();

// ESP32 registra dispositivo (versão simplificada)
app.post('/api/devices/register', (req, res) => {
  const { device_id, firmware, ip } = req.body;

  if (!device_id) {
    return res.status(400).json({ success: false, message: 'device_id obrigatório' });
  }

  console.log(`📱 ESP32 conectado: ${device_id} (IP: ${ip})`);

  // Atualizar status
  deviceStatus.set(device_id, {
    online: true,
    ip: ip,
    firmware: firmware,
    lastSeen: new Date().toISOString()
  });

  res.json({
    success: true,
    message: 'Dispositivo registrado',
    serverTime: new Date().toISOString()
  });
});

// ESP32 busca comandos pendentes
app.get('/api/devices/:deviceId/commands', (req, res) => {
  const deviceId = req.params.deviceId;

  // Buscar comando pendente
  const commands = deviceCommands.get(deviceId) || [];

  if (commands.length > 0) {
    const cmd = commands.shift(); // Remove o primeiro comando
    deviceCommands.set(deviceId, commands);

    console.log(`📤 Enviando comando para ${deviceId}:`, cmd);
    return res.json(cmd);
  }

  res.json({}); // Nenhum comando
});

// ESP32 envia status
app.post('/api/devices/:deviceId/status', (req, res) => {
  const deviceId = req.params.deviceId;
  const { online, food_level, distance_cm, rssi, ip } = req.body;

  console.log(`📊 Status de ${deviceId}: Nível=${food_level}%, Dist=${distance_cm}cm`);

  // Atualizar status
  deviceStatus.set(deviceId, {
    online: online !== false,
    food_level,
    distance_cm,
    rssi,
    ip,
    lastSeen: new Date().toISOString()
  });

  // Atualizar no banco
  db.run(
    'UPDATE devices SET status = ? WHERE device_id = ?',
    ['online', deviceId]
  );

  // Notificar via WebSocket
  db.get('SELECT user_id FROM devices WHERE device_id = ?', [deviceId], (err, device) => {
    if (device) {
      sendToUser(device.user_id, {
        type: 'device_status',
        data: { device_id: deviceId, food_level, distance_cm, online: true }
      });
    }
  });

  res.json({ success: true });
});

// ESP32 registra alimentação
app.post('/api/feed/log', (req, res) => {
  const { device_id, size, steps, food_level_after, trigger } = req.body;

  console.log(`🍽️ Alimentação registrada: ${device_id} - ${size} (${steps} passos)`);

  // Buscar pet e dispositivo
  db.get(
    `SELECT d.id as device_db_id, d.user_id, p.id as pet_id, p.name as pet_name
     FROM devices d
     LEFT JOIN pets p ON p.device_id = d.id
     WHERE d.device_id = ?`,
    [device_id],
    (err, data) => {
      if (data && data.pet_id) {
        // Calcular gramas baseado no size
        const amounts = { small: 50, medium: 100, large: 150 };
        const amount = amounts[size] || 100;

        // Registrar no histórico
        db.run(
          'INSERT INTO feeding_history (pet_id, device_id, amount, trigger_type) VALUES (?, ?, ?, ?)',
          [data.pet_id, data.device_db_id, amount, trigger || 'remote']
        );

        // Notificar via WebSocket
        sendToUser(data.user_id, {
          type: 'feeding_complete',
          data: {
            pet_name: data.pet_name,
            amount,
            size,
            timestamp: new Date().toISOString()
          }
        });
      }

      res.json({ success: true });
    }
  );
});

// Dashboard envia comando para ESP32
app.post('/api/devices/:deviceId/feed', authMiddleware, (req, res) => {
  const deviceId = req.params.deviceId;
  const { size } = req.body;

  // Verificar se dispositivo pertence ao usuário
  db.get(
    'SELECT * FROM devices WHERE device_id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err || !device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }

      // Adicionar comando à fila
      const commands = deviceCommands.get(deviceId) || [];
      commands.push({
        command: 'feed',
        size: size || 'medium'
      });
      deviceCommands.set(deviceId, commands);

      console.log(`📥 Comando de alimentação enfileirado para ${deviceId}: ${size}`);

      res.json({
        success: true,
        message: 'Comando enviado ao dispositivo'
      });
    }
  );
});

// Obter status de dispositivo
app.get('/api/devices/:deviceId/status', authMiddleware, (req, res) => {
  const deviceId = req.params.deviceId;
  const status = deviceStatus.get(deviceId);

  if (!status) {
    return res.json({ online: false, message: 'Dispositivo nunca conectou' });
  }

  res.json(status);
});

// ESP32 busca horários agendados (ROTA PÚBLICA - sem auth)
app.get('/api/devices/:deviceId/schedules', (req, res) => {
  const deviceId = req.params.deviceId;

  console.log(`📅 ESP32 ${deviceId} buscando horários...`);

  // Buscar dispositivo
  db.get('SELECT id, user_id FROM devices WHERE device_id = ?', [deviceId], (err, device) => {
    if (err || !device) {
      return res.json({ success: true, data: [] });
    }

    // Buscar horários do usuário dono do dispositivo
    db.all(
      `SELECT s.hour, s.minute, s.amount, s.days, s.active
       FROM schedules s
       JOIN pets p ON s.pet_id = p.id
       WHERE p.user_id = ? AND s.active = 1`,
      [device.user_id],
      (err, schedules) => {
        if (err) {
          return res.json({ success: true, data: [] });
        }

        // Formatar para o ESP32
        const formatted = (schedules || []).map(s => {
          // Converter amount para size
          let size = 'medium';
          if (s.amount <= 50) size = 'small';
          else if (s.amount >= 150) size = 'large';

          // Parse days
          let days = [];
          try {
            days = JSON.parse(s.days);
          } catch (e) {
            days = [0, 1, 2, 3, 4, 5, 6]; // Todos os dias
          }

          return {
            hour: s.hour,
            minute: s.minute,
            size: size,
            days: days,
            active: s.active === 1
          };
        });

        console.log(`   Enviando ${formatted.length} horários`);
        res.json({ success: true, data: formatted });
      }
    );
  });
});

// ========================================
// HEALTH CHECK
// ========================================

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'PetFeeder Backend',
    version: '1.0.0',
    environment: IS_PRODUCTION ? 'production' : 'development'
  });
});

// ========================================
// CATCH-ALL - Servir frontend para rotas não-API
// ========================================

app.get('*', (req, res) => {
  // Se não for rota de API, servir login.html
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(publicPath, 'login.html'));
  } else {
    res.status(404).json({ success: false, message: 'Rota não encontrada' });
  }
});

// ========================================
// INICIALIZAÇÃO
// ========================================

server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  PetFeeder Backend - MODO DEV          ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ HTTP: http://localhost:${PORT}          ║`);
  console.log(`║ WebSocket: ws://localhost:${WS_PORT}         ║`);
  console.log('║ Database: SQLite (memória)             ║');
  console.log('║ MQTT: Simulado (sem Mosquitto)         ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('✅ Servidor pronto para receber requisições!\n');
  console.log('⚠️  AVISO: Esta versão é apenas para desenvolvimento');
  console.log('    Para produção, use docker-compose.yml\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Encerrando servidor...');

  db.close((err) => {
    if (err) {
      console.error('Erro ao fechar banco:', err);
    } else {
      console.log('✅ Banco fechado');
    }
  });

  wss.close(() => {
    console.log('✅ WebSocket fechado');
  });

  server.close(() => {
    console.log('✅ HTTP Server fechado');
    process.exit(0);
  });
});
