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
      food_level INTEGER DEFAULT 0,
      last_seen DATETIME,
      ip_address TEXT,
      rssi INTEGER,
      power_save INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Adicionar coluna power_save se não existir (migração)
  db.run(`ALTER TABLE devices ADD COLUMN power_save INTEGER DEFAULT 0`, (err) => {
    // Ignora erro se coluna já existe
  });

  // Adicionar colunas de configuração do sensor
  db.run(`ALTER TABLE devices ADD COLUMN sensor_dist_full INTEGER DEFAULT 3`, () => {});
  db.run(`ALTER TABLE devices ADD COLUMN sensor_dist_empty INTEGER DEFAULT 30`, () => {});

  // Garantir que dispositivos existentes tenham valores padrão
  db.run(`UPDATE devices SET power_save = 0 WHERE power_save IS NULL`);
  db.run(`UPDATE devices SET sensor_dist_full = 3 WHERE sensor_dist_full IS NULL`);
  db.run(`UPDATE devices SET sensor_dist_empty = 30 WHERE sensor_dist_empty IS NULL`);

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

  // Migrações para adicionar novas colunas em bancos existentes
  db.run(`ALTER TABLE devices ADD COLUMN food_level INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE devices ADD COLUMN last_seen DATETIME`, () => {});
  db.run(`ALTER TABLE devices ADD COLUMN ip_address TEXT`, () => {});
  db.run(`ALTER TABLE devices ADD COLUMN rssi INTEGER`, () => {});

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
  const OFFLINE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

  db.all(
    'SELECT * FROM devices WHERE user_id = ?',
    [req.userId],
    (err, devices) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao buscar dispositivos' });
      }

      // Calcular status online/offline baseado no last_seen
      const now = Date.now();
      const devicesWithStatus = devices.map(device => {
        const lastSeen = device.last_seen ? new Date(device.last_seen).getTime() : 0;
        const isOnline = (now - lastSeen) < OFFLINE_TIMEOUT_MS;

        // Atualiza status no banco se mudou para offline
        if (!isOnline && device.status === 'online') {
          db.run('UPDATE devices SET status = ? WHERE id = ?', ['offline', device.id]);
        }

        return {
          ...device,
          is_online: isOnline,
          status: isOnline ? 'online' : 'offline',
          last_seen_ago: lastSeen ? formatTimeAgo(now - lastSeen) : null
        };
      });

      res.json({ success: true, data: devicesWithStatus });
    }
  );
});

// Formata tempo relativo (ex: "há 5 min", "há 2 horas")
function formatTimeAgo(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

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

// Auto-registrar dispositivo pelo ESP32 (usando email)
app.post('/api/devices/auto-register', (req, res) => {
  const { deviceId, email, name } = req.body;

  if (!deviceId || !email) {
    return res.status(400).json({ success: false, message: 'deviceId e email obrigatórios' });
  }

  // Busca o usuário pelo email
  db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Erro no servidor' });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Email não encontrado. Crie uma conta primeiro no site.' });
    }

    const deviceName = name || `PetFeeder ${deviceId.slice(-6)}`;

    // Verifica se já existe
    db.get('SELECT id, name FROM devices WHERE device_id = ?', [deviceId], (err, existing) => {
      if (existing) {
        // Atualiza o user_id se o dispositivo já existe
        db.run('UPDATE devices SET user_id = ?, status = ? WHERE device_id = ?',
          [user.id, 'online', deviceId],
          (err) => {
            if (err) {
              return res.status(500).json({ success: false, message: 'Erro ao atualizar dispositivo' });
            }
            console.log(`Dispositivo ${deviceId} re-vinculado ao usuário ${email} (nome mantido: ${existing.name})`);
            res.json({ success: true, message: 'Dispositivo atualizado' });
          }
        );
      } else {
        // Cria novo dispositivo
        db.run(
          'INSERT INTO devices (user_id, device_id, name, status) VALUES (?, ?, ?, ?)',
          [user.id, deviceId, deviceName, 'online'],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Erro ao vincular dispositivo' });
            }
            console.log(`Dispositivo ${deviceId} vinculado ao usuário ${email}`);
            res.json({ success: true, message: 'Dispositivo vinculado com sucesso' });
          }
        );
      }
    });
  });
});

// Editar dispositivo
app.put('/api/devices/:id', authMiddleware, (req, res) => {
  const deviceId = req.params.id;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
  }

  db.run(
    'UPDATE devices SET name = ? WHERE id = ? AND user_id = ?',
    [name, deviceId, req.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao atualizar dispositivo' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }
      console.log(`Dispositivo ${deviceId} renomeado para: ${name}`);
      res.json({ success: true, message: 'Dispositivo atualizado' });
    }
  );
});

// Desvincular dispositivo
app.delete('/api/devices/:id', authMiddleware, (req, res) => {
  const deviceId = req.params.id;

  // Primeiro, remover pets associados
  db.run('DELETE FROM pets WHERE device_id = ? AND user_id = ?', [deviceId, req.userId], (err) => {
    if (err) {
      console.error('Erro ao remover pets:', err);
    }

    // Depois, remover o dispositivo
    db.run(
      'DELETE FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, req.userId],
      function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Erro ao desvincular dispositivo' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
        }
        console.log(`Dispositivo ${deviceId} desvinculado`);
        res.json({ success: true, message: 'Dispositivo desvinculado' });
      }
    );
  });
});

// Toggle modo economia de energia
app.put('/api/devices/:id/power-save', authMiddleware, (req, res) => {
  const deviceId = req.params.id;
  const { enabled } = req.body;

  db.run(
    'UPDATE devices SET power_save = ? WHERE id = ? AND user_id = ?',
    [enabled ? 1 : 0, deviceId, req.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao atualizar modo economia' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }

      // Buscar device_id para enviar comando
      db.get('SELECT device_id FROM devices WHERE id = ?', [deviceId], (err, device) => {
        if (device) {
          // Adiciona comando de sync para o ESP32 atualizar configuração
          const commands = deviceCommands.get(device.device_id) || [];
          commands.push({ command: 'sync' });
          deviceCommands.set(device.device_id, commands);
          console.log(`⚡ Modo economia ${enabled ? 'ATIVADO' : 'DESATIVADO'} para ${device.device_id}`);
        }
      });

      res.json({
        success: true,
        message: `Modo economia ${enabled ? 'ativado' : 'desativado'}`,
        power_save: enabled
      });
    }
  );
});

// Reiniciar dispositivo (comando via WebSocket)
app.post('/api/devices/:id/restart', authMiddleware, (req, res) => {
  const deviceId = req.params.id;

  // Buscar device_id real
  db.get(
    'SELECT device_id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err || !device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }

      // Enviar comando via WebSocket (se estiver conectado)
      console.log(`🔄 Comando de reinício enviado para ${device.device_id}`);

      // TODO: Implementar envio real via WebSocket quando ESP32 suportar
      res.json({ success: true, message: 'Comando de reinício enviado' });
    }
  );
});

// ========================================
// ROTAS DE PETS
// ========================================

// Listar pets
app.get('/api/pets', authMiddleware, (req, res) => {
  db.all(
    `SELECT p.id, p.name, p.type, p.compartment, p.daily_amount,
            p.device_id, d.name as device_name, d.device_id as device_code
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

// Atualizar pet
app.put('/api/pets/:id', authMiddleware, (req, res) => {
  const petId = req.params.id;
  const { name, type, deviceId, compartment, dailyAmount } = req.body;

  const updates = [];
  const values = [];

  if (name) { updates.push('name = ?'); values.push(name); }
  if (type) { updates.push('type = ?'); values.push(type); }
  if (deviceId) { updates.push('device_id = ?'); values.push(deviceId); }
  if (compartment !== undefined) { updates.push('compartment = ?'); values.push(compartment); }
  if (dailyAmount) { updates.push('daily_amount = ?'); values.push(dailyAmount); }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'Nenhum dado para atualizar' });
  }

  values.push(petId, req.userId);

  db.run(
    `UPDATE pets SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
    values,
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao atualizar pet' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Pet não encontrado' });
      }
      res.json({ success: true, message: 'Pet atualizado' });
    }
  );
});

// Excluir pet
app.delete('/api/pets/:id', authMiddleware, (req, res) => {
  const petId = req.params.id;

  db.run(
    'DELETE FROM pets WHERE id = ? AND user_id = ?',
    [petId, req.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erro ao excluir pet' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Pet não encontrado' });
      }
      res.json({ success: true, message: 'Pet excluído' });
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

  // Verificar se pet pertence ao usuário e buscar device_id string
  db.get(
    `SELECT p.*, d.device_id as esp_device_id, d.id as device_db_id
     FROM pets p
     JOIN devices d ON p.device_id = d.id
     WHERE p.id = ? AND p.user_id = ?`,
    [petId, req.userId],
    (err, pet) => {
      if (err || !pet) {
        return res.status(404).json({ error: 'Pet não encontrado' });
      }

      // Converter amount para size
      let size = 'medium';
      if (amount <= 50) size = 'small';
      else if (amount <= 100) size = 'medium';
      else size = 'large';

      // Usar o device_id string (ex: PF_2FCC9C) para o ESP32
      const espDeviceId = pet.esp_device_id;

      // Adicionar comando à fila para o ESP32 buscar
      const commands = deviceCommands.get(espDeviceId) || [];
      commands.push({
        command: 'feed',
        size: size
      });
      deviceCommands.set(espDeviceId, commands);

      console.log(`📤 Comando de alimentação enfileirado para ${espDeviceId}: ${size} (${amount}g)`);

      // Registrar alimentação (usando o ID do banco para a FK)
      db.run(
        'INSERT INTO feeding_history (pet_id, device_id, amount, trigger_type) VALUES (?, ?, ?, ?)',
        [petId, pet.device_db_id, amount, 'manual'],
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
            message: `Alimentação de ${amount}g para ${pet.name} enviada ao dispositivo!`,
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
    `SELECT fh.id, fh.pet_id, fh.amount,
            fh.trigger_type as trigger,
            fh.created_at as timestamp,
            p.name as pet_name,
            d.name as device_name,
            d.device_id as device_id
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
      // Adicionar status success e formatar timestamp como UTC
      const formattedHistory = (history || []).map(h => ({
        ...h,
        status: 'success',
        // Adicionar 'Z' para indicar UTC (SQLite não inclui timezone)
        timestamp: h.timestamp ? h.timestamp.replace(' ', 'T') + 'Z' : null
      }));
      res.json({ success: true, data: formattedHistory });
    }
  );
});

// Alias para /api/feedings (usado pelo frontend)
app.get('/api/feedings', authMiddleware, (req, res) => {
  db.all(
    `SELECT fh.id, fh.pet_id, fh.amount,
            fh.trigger_type as trigger,
            fh.created_at as timestamp,
            p.name as pet_name,
            d.name as device_name,
            d.device_id as device_id
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
      // Formatar timestamp como UTC
      const formattedHistory = (history || []).map(h => ({
        ...h,
        timestamp: h.timestamp ? h.timestamp.replace(' ', 'T') + 'Z' : null
      }));
      res.json({ success: true, data: formattedHistory });
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

      // Converter days de string JSON para propriedades individuais
      const schedulesFormatted = (schedules || []).map(s => {
        const days = JSON.parse(s.days || '{}');
        return {
          ...s,
          monday: days.monday || false,
          tuesday: days.tuesday || false,
          wednesday: days.wednesday || false,
          thursday: days.thursday || false,
          friday: days.friday || false,
          saturday: days.saturday || false,
          sunday: days.sunday || false,
        };
      });

      res.json({ success: true, data: schedulesFormatted });
    }
  );
});

// Criar horário
app.post('/api/schedules', authMiddleware, (req, res) => {
  const { petId, deviceId, hour, minute, amount, days } = req.body;

  if (petId === undefined || deviceId === undefined || hour === undefined || minute === undefined || !amount || !days) {
    return res.status(400).json({ success: false, error: 'Dados incompletos' });
  }

  // Verificar se pet pertence ao usuário
  db.get(
    'SELECT * FROM pets WHERE id = ? AND user_id = ?',
    [petId, req.userId],
    (err, pet) => {
      if (err || !pet) {
        return res.status(404).json({ success: false, error: 'Pet não encontrado' });
      }

      // Verificar se já existe horário duplicado para este pet
      db.get(
        'SELECT id FROM schedules WHERE pet_id = ? AND hour = ? AND minute = ?',
        [petId, hour, minute],
        (errDup, existing) => {
          if (errDup) {
            console.error('[SCHEDULES] Erro ao verificar duplicado:', errDup);
          }
          if (existing) {
            console.log(`[SCHEDULES] Duplicado: ${hour}:${minute} já existe para pet ${petId}`);
            return res.status(400).json({
              success: false,
              error: `Já existe um horário às ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} para este pet`
            });
          }

          db.run(
            'INSERT INTO schedules (pet_id, device_id, hour, minute, amount, days) VALUES (?, ?, ?, ?, ?, ?)',
            [petId, deviceId, hour, minute, amount, JSON.stringify(days)],
            function(err) {
              if (err) {
                console.error('[SCHEDULES] Erro ao criar:', err);
                return res.status(500).json({ success: false, error: 'Erro ao criar horário' });
              }

              console.log(`[SCHEDULES] Criado: ${hour}:${minute} para pet ${petId}`);

              // Enviar comando sync para o ESP32
              db.get('SELECT device_id FROM devices WHERE id = ?', [deviceId], (errDev, device) => {
                if (device && device.device_id) {
                  const commands = deviceCommands.get(device.device_id) || [];
                  commands.push({ command: 'sync' });
                  deviceCommands.set(device.device_id, commands);
                  console.log(`📤 Comando SYNC enfileirado para ${device.device_id} (novo horário ${hour}:${minute})`);
                }
              });

              res.json({
                success: true,
                data: {
                  id: this.lastID,
                  pet_id: petId,
                  device_id: deviceId,
                  hour,
                  minute,
                  amount,
                  days,
                  active: true
                }
              });
            }
          );
        }
      );
    }
  );
});

// Atualizar horário
app.put('/api/schedules/:id', authMiddleware, (req, res) => {
  const scheduleId = req.params.id;
  const { hour, minute, amount, days, active } = req.body;

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

      const updates = [];
      const values = [];

      if (hour !== undefined) { updates.push('hour = ?'); values.push(hour); }
      if (minute !== undefined) { updates.push('minute = ?'); values.push(minute); }
      if (amount !== undefined) { updates.push('amount = ?'); values.push(amount); }
      if (days !== undefined) { updates.push('days = ?'); values.push(days); }
      if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0); }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum dado para atualizar' });
      }

      values.push(scheduleId);

      db.run(
        `UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`,
        values,
        function(err) {
          if (err) {
            return res.status(500).json({ success: false, message: 'Erro ao atualizar horário' });
          }

          // Enviar comando sync para o ESP32
          db.get('SELECT device_id FROM devices WHERE id = ?', [schedule.device_id], (_, device) => {
            if (device && device.device_id) {
              const commands = deviceCommands.get(device.device_id) || [];
              commands.push({ command: 'sync' });
              deviceCommands.set(device.device_id, commands);
              console.log(`📤 Comando SYNC enfileirado para ${device.device_id} (horário atualizado)`);
            }
          });

          res.json({ success: true, message: 'Horário atualizado' });
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

      // Guardar device_id antes de deletar
      const scheduleDeviceId = schedule.device_id;

      db.run('DELETE FROM schedules WHERE id = ?', [scheduleId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao deletar horário' });
        }

        // Enviar comando sync para o ESP32
        db.get('SELECT device_id FROM devices WHERE id = ?', [scheduleDeviceId], (_, device) => {
          if (device && device.device_id) {
            const commands = deviceCommands.get(device.device_id) || [];
            commands.push({ command: 'sync' });
            deviceCommands.set(device.device_id, commands);
            console.log(`📤 Comando SYNC enfileirado para ${device.device_id} (horário deletado)`);
          }
        });

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
const lastFoodAlert = new Map();  // Rastreia último alerta enviado por dispositivo

// ESP32 busca comandos pendentes
app.get('/api/devices/:deviceId/commands', (req, res) => {
  const deviceId = req.params.deviceId;

  // Atualiza last_seen para manter dispositivo "online" enquanto faz polling
  const now = new Date().toISOString();
  db.run(
    'UPDATE devices SET last_seen = ?, status = ? WHERE device_id = ?',
    [now, 'online', deviceId]
  );

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
  const { online, food_level, distance_cm, rssi, ip, mode, power_save_enabled, schedules_count } = req.body;
  const now = new Date().toISOString();

  const modeNames = {
    'config': '🔧 Configuração',
    'waiting': '⏳ Aguardando horários',
    'active': '✅ Ativo (recebe comandos)',
    'sleep': '😴 Deep Sleep'
  };

  console.log(`📊 Status de ${deviceId}:`);
  console.log(`   Nível: ${food_level}%`);
  console.log(`   Modo: ${modeNames[mode] || mode}`);
  console.log(`   Economia: ${power_save_enabled ? 'ON' : 'OFF'}`);
  console.log(`   IP: ${ip}`);

  // Atualizar status em memória
  deviceStatus.set(deviceId, {
    online: online !== false,
    food_level,
    distance_cm,
    rssi,
    ip,
    mode,
    power_save_enabled,
    schedules_count,
    lastSeen: now
  });

  // Atualizar no banco (persistente)
  db.run(
    `UPDATE devices SET
      status = 'online',
      food_level = ?,
      last_seen = ?,
      ip_address = ?,
      rssi = ?
    WHERE device_id = ?`,
    [food_level || 0, now, ip || null, rssi || null, deviceId]
  );

  // Notificar via WebSocket
  db.get('SELECT user_id, name FROM devices WHERE device_id = ?', [deviceId], (err, device) => {
    if (device) {
      sendToUser(device.user_id, {
        type: 'device_status',
        data: {
          device_id: deviceId,
          food_level,
          distance_cm,
          online: true,
          last_seen: now,
          mode,
          power_save_enabled,
          schedules_count
        }
      });

      // ========== ALERTAS DE NÍVEL BAIXO ==========
      const lastAlert = lastFoodAlert.get(deviceId) || { level: 100, timestamp: 0 };
      const currentLevel = food_level || 0;
      const deviceName = device.name || deviceId;

      // Determina qual alerta enviar (evita repetição)
      let alertType = null;
      let alertMessage = null;

      if (currentLevel <= 10 && lastAlert.level > 10) {
        // Cruzou threshold de 10% - ração acabando!
        alertType = 'critical';
        alertMessage = `⚠️ Ração acabando! ${deviceName} está com apenas ${currentLevel}% de ração.`;
        console.log(`🚨 ALERTA CRÍTICO: ${deviceId} com ${currentLevel}% de ração`);
      } else if (currentLevel <= 50 && currentLevel > 10 && lastAlert.level > 50) {
        // Cruzou threshold de 50% - metade
        alertType = 'warning';
        alertMessage = `📉 Ração na metade! ${deviceName} está com ${currentLevel}% de ração.`;
        console.log(`⚠️ ALERTA: ${deviceId} com ${currentLevel}% de ração (metade)`);
      }

      // Envia alerta se necessário
      if (alertType && alertMessage) {
        sendToUser(device.user_id, {
          type: 'food_alert',
          data: {
            device_id: deviceId,
            device_name: deviceName,
            food_level: currentLevel,
            alert_type: alertType,
            message: alertMessage,
            timestamp: now
          }
        });

        // Atualiza último alerta enviado
        lastFoodAlert.set(deviceId, { level: currentLevel, timestamp: Date.now() });
      } else if (currentLevel > 50 && lastAlert.level <= 50) {
        // Reabasteceu - reseta o rastreamento
        lastFoodAlert.set(deviceId, { level: currentLevel, timestamp: Date.now() });
        console.log(`✅ ${deviceId} reabastecido: ${currentLevel}%`);
      }
    }
  });

  res.json({ success: true });
});

// ESP32 registra alimentação
app.post('/api/feed/log', (req, res) => {
  const { device_id, size, steps, food_level_after, trigger, pet_name } = req.body;

  console.log(`🍽️ Alimentação registrada: ${device_id} - ${size} - pet: ${pet_name || 'N/A'}`);

  // Buscar dispositivo primeiro
  db.get('SELECT id, user_id FROM devices WHERE device_id = ?', [device_id], (err, device) => {
    if (err || !device) {
      console.log(`⚠️ Dispositivo ${device_id} não encontrado`);
      return res.json({ success: false, message: 'Dispositivo não encontrado' });
    }

    // Calcular gramas baseado no size
    const amounts = { small: 50, medium: 100, large: 150 };
    const amount = amounts[size] || 100;

    // Buscar pet pelo nome (enviado pelo ESP32) ou pelo device_id
    let petQuery;
    let petParams;

    if (pet_name) {
      // ESP32 enviou o nome do pet - buscar por nome e user_id
      petQuery = 'SELECT id, name FROM pets WHERE name = ? AND user_id = ?';
      petParams = [pet_name, device.user_id];
    } else {
      // Fallback: buscar pet vinculado ao device
      petQuery = 'SELECT id, name FROM pets WHERE device_id = ?';
      petParams = [device.id];
    }

    db.get(petQuery, petParams, (err, pet) => {
      if (err || !pet) {
        console.log(`⚠️ Pet não encontrado para ${device_id}. Query: ${petQuery}, Params: ${petParams}`);
        // Ainda retorna sucesso, mas não registra no histórico
        return res.json({ success: true, message: 'Pet não encontrado, histórico não registrado' });
      }

      console.log(`✅ Pet encontrado: ${pet.name} (id: ${pet.id})`);

      // Registrar no histórico
      db.run(
        'INSERT INTO feeding_history (pet_id, device_id, amount, trigger_type) VALUES (?, ?, ?, ?)',
        [pet.id, device.id, amount, trigger || 'remote'],
        function(err) {
          if (err) {
            console.log(`❌ Erro ao salvar histórico: ${err.message}`);
          } else {
            console.log(`📝 Histórico salvo: pet_id=${pet.id}, amount=${amount}g, trigger=${trigger}`);
          }
        }
      );

      // Notificar via WebSocket
      sendToUser(device.user_id, {
        type: 'feeding_complete',
        data: {
          pet_name: pet.name,
          amount,
          size,
          timestamp: new Date().toISOString()
        }
      });

      res.json({ success: true });
    });
  });
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
    return res.json({ success: true, data: { online: false, food_level: null, message: 'Dispositivo nunca conectou' } });
  }

  res.json({ success: true, data: status });
});

// Solicitar leitura de nível do sensor (envia comando para ESP32)
app.post('/api/devices/:deviceId/check-level', authMiddleware, (req, res) => {
  const deviceId = req.params.deviceId;

  // Verificar se dispositivo pertence ao usuário
  db.get(
    'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err || !device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }

      // Adicionar comando à fila para o ESP32
      const commands = deviceCommands.get(deviceId) || [];
      commands.push({
        command: 'check_level'
      });
      deviceCommands.set(deviceId, commands);

      console.log(`📊 Comando check_level enviado para ${deviceId}`);

      res.json({
        success: true,
        message: 'Comando enviado. Aguarde o ESP32 responder.',
        hint: 'O ESP32 deve enviar o status em alguns segundos se estiver online.'
      });
    }
  );
});

// ESP32 busca horários agendados (ROTA PÚBLICA - sem auth)
app.get('/api/devices/:deviceId/schedules', (req, res) => {
  const deviceId = req.params.deviceId;

  console.log(`📅 ESP32 ${deviceId} buscando horários...`);

  // Buscar dispositivo (incluindo power_save)
  db.get('SELECT id, user_id, power_save FROM devices WHERE device_id = ?', [deviceId], (err, device) => {
    if (err || !device) {
      return res.json({ success: true, data: [], power_save: false });
    }

    // Buscar horários do usuário dono do dispositivo
    // IMPORTANTE: ORDER BY garante ordem consistente para o bitmask executedToday do ESP32
    db.all(
      `SELECT s.hour, s.minute, s.amount, s.days, s.active, p.name as pet_name
       FROM schedules s
       JOIN pets p ON s.pet_id = p.id
       WHERE p.user_id = ? AND s.active = 1
       ORDER BY s.hour, s.minute`,
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
          else if (s.amount > 100) size = 'large';

          // Parse days e converter para array de números
          // ESP32 espera: [0, 1, 2, 3, 4, 5, 6] onde 0=Dom, 1=Seg, etc.
          let daysArray = [];
          try {
            const daysData = JSON.parse(s.days);
            if (Array.isArray(daysData)) {
              // Já é array (formato antigo)
              daysArray = daysData;
            } else {
              // Formato objeto {monday: true, ...}
              const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
              dayNames.forEach((name, index) => {
                if (daysData[name]) {
                  daysArray.push(index);
                }
              });
            }
          } catch (e) {
            daysArray = [0, 1, 2, 3, 4, 5, 6]; // Todos os dias
          }

          // Se array vazio, usar todos os dias
          if (daysArray.length === 0) {
            daysArray = [0, 1, 2, 3, 4, 5, 6];
          }

          return {
            hour: s.hour,
            minute: s.minute,
            size: size,
            days: daysArray,
            active: s.active === 1,
            pet: s.pet_name || 'Pet'
          };
        });

        const powerSaveValue = device.power_save === 1;
        console.log(`   Enviando ${formatted.length} horários (ordenados por hora:minuto):`);
        formatted.forEach((s, i) => {
          console.log(`     [${i}] ${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')} ${s.pet} ${s.size}`);
        });
        console.log(`   power_save: ${powerSaveValue}`);
        res.json({
          success: true,
          data: formatted,
          power_save: powerSaveValue
        });
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
  console.log('║ ESP32 executa horários internamente    ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('✅ Servidor pronto para receber requisições!\n');
  console.log('📋 Fluxo de horários:');
  console.log('   1. Usuário cria horário no site');
  console.log('   2. ESP32 sincroniza horários (GET /api/devices/:id/schedules)');
  console.log('   3. ESP32 salva na memória flash');
  console.log('   4. ESP32 verifica e executa internamente\n');
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
