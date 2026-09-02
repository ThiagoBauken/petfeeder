/*
 * PetFeeder Backend — container único (Node.js + SQLite)
 *
 * - HTTP REST + WebSocket no MESMO servidor (WebSocket no path /ws)
 * - Dispositivos ESP32 comunicam por HTTP polling autenticado (header X-Device-Secret)
 * - Secrets JWT lidos do ambiente (obrigatórios em produção)
 *
 * Variáveis de ambiente (ver .env.example):
 *   NODE_ENV, PORT, DB_PATH, JWT_SECRET, JWT_REFRESH_SECRET, CORS_ORIGINS
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { WebSocketServer } = require('ws');

// ========================================
// CONFIGURAÇÃO
// ========================================

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);

// Secrets: obrigatórios (>=32 chars) em produção.
// Em desenvolvimento, se ausentes, gera um secret efêmero e avisa
// (tokens deixam de valer ao reiniciar — aceitável só em dev).
function loadSecret(name) {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (IS_PRODUCTION) {
    console.error(`❌ ${name} ausente ou com menos de 32 caracteres. Defina no ambiente. Abortando.`);
    process.exit(1);
  }
  console.warn(`⚠️  ${name} não definido — usando secret EFÊMERO de desenvolvimento.`);
  return crypto.randomBytes(48).toString('hex');
}
const JWT_SECRET = loadSecret('JWT_SECRET');
const JWT_REFRESH_SECRET = loadSecret('JWT_REFRESH_SECRET');

// Allowlist de CORS (lista separada por vírgula). Vazio => apenas mesma origem.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ========================================
// BANCO DE DADOS SQLite
// ========================================

// Em produção usa arquivo persistente; em dev usa memória (configurável por DB_PATH)
const DB_PATH = process.env.DB_PATH || (IS_PRODUCTION ? '/app/data/petfeeder.db' : ':memory:');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Erro ao criar banco:', err);
    process.exit(1);
  }
  console.log(`✅ Banco SQLite: ${DB_PATH}`);
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

  // Segredo por dispositivo (autentica as rotas HTTP do ESP32)
  db.run(`ALTER TABLE devices ADD COLUMN device_secret TEXT`, () => {});

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

  // Índices para as colunas usadas em WHERE/JOIN das rotas quentes
  db.run(`CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pets_user ON pets(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pets_device ON pets(device_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sched_pet ON schedules(pet_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sched_device ON schedules(device_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_feed_pet ON feeding_history(pet_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_feed_created ON feeding_history(created_at)`);

  // Normaliza e-mails já gravados (o login passou a buscar sempre em minúsculo)
  db.run(`UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email))`);

  // Backfill: todo dispositivo precisa de segredo — sem ele as rotas do ESP32
  // agora respondem 401 (não há mais liberação por compatibilidade).
  db.all(`SELECT id FROM devices WHERE device_secret IS NULL OR device_secret = ''`, (err, rows) => {
    if (err || !rows || rows.length === 0) return;
    rows.forEach((row) => {
      db.run(`UPDATE devices SET device_secret = ? WHERE id = ?`, [generateDeviceSecret(), row.id]);
    });
    console.log(`🔑 Backfill: segredo gerado para ${rows.length} dispositivo(s) sem segredo`);
  });

  console.log('✅ Tabelas verificadas/criadas');
});

// ========================================
// EXPRESS APP
// ========================================

const app = express();
const server = http.createServer(app);

// Headers de segurança (CSP desativado: o frontend usa scripts/estilos inline + CDNs)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS com allowlist (sem allowlist => apenas mesma origem / ferramentas sem Origin)
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin, apps mobile, curl
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Origem não permitida pelo CORS'));
  },
}));

app.use(express.json({ limit: '256kb' }));

// Rate limiter para rotas sensíveis de autenticação (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Aguarde e tente novamente.' },
});

// Servir frontend estático
// Em produção: ./public (dentro do container)
// Em dev: ../frontend (pasta local)
const publicPath = IS_PRODUCTION
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'frontend');
app.use(express.static(publicPath));
console.log(`📁 Frontend: ${publicPath}`);

// Logging enxuto (apenas chamadas de API)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) console.log(`${req.method} ${req.path}`);
  next();
});

// ========================================
// WEBSOCKET SERVER (mesmo servidor HTTP, path /ws)
// ========================================

const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Map();

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket cliente conectado');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Aceita 'authenticate' (frontend) e 'auth' (legado)
      if ((data.type === 'authenticate' || data.type === 'auth') && data.token) {
        try {
          if (revokedTokens.has(data.token)) throw new Error('revogado');
          const decoded = jwt.verify(data.token, JWT_SECRET);
          wsClients.set(decoded.userId, ws);
          ws.send(JSON.stringify({ type: 'authenticated', status: 'success' }));
          console.log(`✅ WebSocket autenticado: user ${decoded.userId}`);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'Token inválido' }));
        }
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'subscribe') {
        ws.send(JSON.stringify({ type: 'subscribed', topics: data.topics || [] }));
      }
    } catch (err) {
      console.error('Erro ao processar mensagem WS:', err.message);
    }
  });

  ws.on('close', () => {
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

// Tokens revogados via logout (em memória — válido para 1 instância).
// Como o access token expira em 1h, o conjunto se mantém pequeno.
const revokedTokens = new Set();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.substring(7);

  if (revokedTokens.has(token)) {
    return res.status(401).json({ error: 'Token revogado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.accessToken = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ========================================
// AUTENTICAÇÃO DE DISPOSITIVO (ESP32)
// ========================================

// Gera um segredo aleatório para o dispositivo
function generateDeviceSecret() {
  return crypto.randomBytes(24).toString('hex');
}

// Formato aceito de device_id (o firmware gera "PF_" + 6 hex)
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Normaliza os dias da semana vindos do cliente.
// Aceita tanto { days: { monday: true, ... } } quanto os sete booleanos soltos
// no corpo (formato que o modal de edição envia). Retorna null se nenhum dia
// foi marcado — nesse caso o campo simplesmente não é atualizado.
function normalizeDays(body) {
  if (!body || typeof body !== 'object') return null;
  const base = (body.days && typeof body.days === 'object' && !Array.isArray(body.days))
    ? body.days
    : body;
  const out = {};
  let any = false;
  for (const d of WEEKDAYS) {
    out[d] = base[d] === true || base[d] === 1 || base[d] === 'true';
    if (out[d]) any = true;
  }
  return any ? out : null;
}

function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Comparação em tempo constante (evita timing attack na checagem do segredo)
function secretsMatch(provided, stored) {
  if (typeof provided !== 'string' || typeof stored !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Valida o header X-Device-Secret contra o segredo salvo do dispositivo.
// deviceIdGetter extrai o device_id da requisição (params ou body).
function deviceAuth(deviceIdGetter) {
  return (req, res, next) => {
    const deviceId = deviceIdGetter(req);
    if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
      return res.status(400).json({ success: false, message: 'device_id ausente ou inválido' });
    }
    const provided = req.get('X-Device-Secret') || (req.body && req.body.device_secret) || req.query.s;
    db.get('SELECT device_secret FROM devices WHERE device_id = ?', [deviceId], (err, row) => {
      if (err) return res.status(500).json({ success: false, message: 'Erro interno' });
      if (!row) return res.status(404).json({ success: false, message: 'Dispositivo não registrado' });
      // Sem segredo o dispositivo NÃO é autenticado (nada de liberar por compatibilidade):
      // todo device recebe segredo ao ser criado/vinculado e no backfill de inicialização.
      if (!row.device_secret) {
        return res.status(401).json({ success: false, message: 'Dispositivo sem segredo — refaça o pareamento' });
      }
      if (secretsMatch(provided, row.device_secret)) return next();
      return res.status(401).json({ success: false, message: 'Device secret inválido' });
    });
  };
}

// ========================================
// ROTAS DE AUTENTICAÇÃO
// ========================================

// Registrar
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body || {};

  // Checagem de TIPO antes de qualquer uso: um password numérico fazia o
  // bcrypt rejeitar dentro do handler async e derrubava o processo.
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Dados incompletos ou inválidos' });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail) {
    return res.status(400).json({ error: 'Nome e email são obrigatórios' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }

  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(password, 10);
  } catch (e) {
    console.error('Erro ao gerar hash da senha:', e.message);
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }

  db.run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [cleanName, cleanEmail, passwordHash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Email já cadastrado' });
        }
        return res.status(500).json({ error: 'Erro ao criar usuário' });
      }

      const userId = this.lastID;
      const accessToken = jwt.sign({ userId, email: cleanEmail }, JWT_SECRET, { expiresIn: '1h' });
      const refreshToken = jwt.sign({ userId, email: cleanEmail }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: userId, name: cleanName, email: cleanEmail, plan: 'free' }
        }
      });
    }
  );
});

// Login
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};

  // Checagem de TIPO: sem isso um password não-string rejeitava no bcrypt
  // dentro do callback async e encerrava o processo.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email e senha obrigatórios' });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.get('SELECT * FROM users WHERE email = ?', [cleanEmail], async (err, user) => {
    try {
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
    } catch (e) {
      console.error('Erro no login:', e.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  });
});

// Refresh token
app.post('/api/auth/refresh', authLimiter, (req, res) => {
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

// Logout (revoga o access token atual)
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  if (req.accessToken) revokedTokens.add(req.accessToken);
  res.json({ success: true, message: 'Logout realizado' });
});

// ========================================
// ROTAS DE DISPOSITIVOS
// ========================================

// Obs.: a rota antiga POST /api/devices/register (que confiava no userId como token)
// foi removida. O ESP32 usa POST /api/devices/auto-register (autenticado pelo email da conta).

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

// Vincular dispositivo (pelo dashboard). Já nasce COM segredo — sem isso o
// dispositivo ficaria sem autenticação nas rotas do ESP32.
app.post('/api/devices/link', authMiddleware, (req, res) => {
  const { deviceId, name } = req.body || {};

  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({ success: false, message: 'deviceId ausente ou inválido' });
  }

  const deviceName = (typeof name === 'string' && name.trim())
    ? name.trim().slice(0, 60)
    : `PetFeeder ${deviceId.slice(-6)}`;
  const secret = generateDeviceSecret();

  db.run(
    'INSERT INTO devices (user_id, device_id, name, status, device_secret) VALUES (?, ?, ?, ?, ?)',
    [req.userId, deviceId, deviceName, 'offline', secret],
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
          status: 'offline',
          device_secret: secret
        }
      });
    }
  );
});

// Auto-registrar dispositivo pelo ESP32 (autenticado pelo email da conta).
// Emite/retorna um device_secret que o ESP32 deve guardar e enviar (X-Device-Secret)
// em todas as chamadas seguintes (/commands, /status, /schedules, /feed/log).
app.post('/api/devices/auto-register', authLimiter, (req, res) => {
  const { deviceId, email } = req.body || {};
  const providedSecret = req.get('X-Device-Secret') || (req.body && req.body.device_secret);

  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({ success: false, message: 'deviceId ausente ou inválido' });
  }
  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ success: false, message: 'email obrigatório' });
  }

  // O nome NUNCA vem do corpo: esta rota é pública, então texto arbitrário aqui
  // acabaria renderizado no dashboard. Deriva sempre do próprio deviceId.
  const deviceName = `PetFeeder ${deviceId.slice(-6)}`;

  db.get('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: 'Erro no servidor' });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Email não encontrado. Crie uma conta primeiro no site.' });
    }

    db.get('SELECT id, user_id, device_secret FROM devices WHERE device_id = ?', [deviceId], (err2, existing) => {
      if (err2) return res.status(500).json({ success: false, message: 'Erro no servidor' });

      if (existing) {
        // Anti-sequestro: re-vincular para OUTRA conta exige o segredo correto —
        // inclusive quando o dispositivo ainda não tem segredo gravado.
        if (existing.user_id !== user.id && !secretsMatch(providedSecret, existing.device_secret)) {
          return res.status(403).json({ success: false, message: 'Dispositivo já vinculado a outra conta' });
        }
        const secret = existing.device_secret || generateDeviceSecret();
        db.run('UPDATE devices SET user_id = ?, status = ?, device_secret = ? WHERE device_id = ?',
          [user.id, 'online', secret, deviceId],
          (err3) => {
            if (err3) return res.status(500).json({ success: false, message: 'Erro ao atualizar dispositivo' });
            console.log(`Dispositivo ${deviceId} re-vinculado ao usuário ${email}`);
            res.json({ success: true, message: 'Dispositivo atualizado', device_secret: secret });
          }
        );
      } else {
        const secret = generateDeviceSecret();
        db.run(
          'INSERT INTO devices (user_id, device_id, name, status, device_secret) VALUES (?, ?, ?, ?, ?)',
          [user.id, deviceId, deviceName, 'online', secret],
          function(err3) {
            if (err3) return res.status(500).json({ success: false, message: 'Erro ao vincular dispositivo' });
            console.log(`Dispositivo ${deviceId} vinculado ao usuário ${email}`);
            res.json({ success: true, message: 'Dispositivo vinculado com sucesso', device_secret: secret });
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

// Reiniciar dispositivo (enfileira comando 'restart'; o ESP32 busca no polling de /commands)
app.post('/api/devices/:id/restart', authMiddleware, (req, res) => {
  const deviceId = req.params.id;

  db.get(
    'SELECT device_id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err || !device) {
        return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
      }

      const commands = deviceCommands.get(device.device_id) || [];
      commands.push({ command: 'restart' });
      deviceCommands.set(device.device_id, commands);
      console.log(`🔄 Comando de reinício enfileirado para ${device.device_id}`);

      res.json({ success: true, message: 'Comando de reinício enviado ao dispositivo' });
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
  const { name, type, deviceId, compartment, dailyAmount } = req.body || {};

  const applyUpdate = () => {
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
  };

  // Se o cliente mandou deviceId, confirmar que o dispositivo é DESTE usuário.
  // Sem isso era possível apontar o pet para o alimentador de outra conta e,
  // via POST /api/feed/now, acionar o aparelho alheio.
  if (deviceId) {
    return db.get(
      'SELECT id FROM devices WHERE id = ? AND user_id = ?',
      [deviceId, req.userId],
      (err, device) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro interno' });
        if (!device) return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
        applyUpdate();
      }
    );
  }

  applyUpdate();
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

      // Converter days de string JSON para propriedades individuais.
      // O parse é protegido: um valor corrompido na coluna não pode derrubar
      // o processo (era exceção não capturada dentro do callback).
      const schedulesFormatted = (schedules || []).map(s => {
        let days = {};
        try {
          const parsed = JSON.parse(s.days || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) days = parsed;
        } catch (e) {
          console.warn(`[SCHEDULES] days inválido no horário ${s.id}, tratando como vazio`);
        }
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
  const { petId, hour, minute, amount } = req.body || {};
  const days = normalizeDays(req.body);

  if (petId === undefined) {
    return res.status(400).json({ success: false, error: 'petId obrigatório' });
  }
  if (!isInt(hour, 0, 23) || !isInt(minute, 0, 59)) {
    return res.status(400).json({ success: false, error: 'Horário inválido (hora 0-23, minuto 0-59)' });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 2000) {
    return res.status(400).json({ success: false, error: 'Quantidade inválida (1-2000 g)' });
  }
  if (!days) {
    return res.status(400).json({ success: false, error: 'Selecione ao menos um dia da semana' });
  }

  // Verificar se pet pertence ao usuário
  db.get(
    'SELECT * FROM pets WHERE id = ? AND user_id = ?',
    [petId, req.userId],
    (err, pet) => {
      if (err || !pet) {
        return res.status(404).json({ success: false, error: 'Pet não encontrado' });
      }

      // O dispositivo é SEMPRE derivado do pet já validado — aceitar deviceId do
      // corpo permitia criar horário apontando para o alimentador de outra conta.
      const deviceId = pet.device_id;

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
            [petId, deviceId, hour, minute, amountNum, JSON.stringify(days)],
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
                  amount: amountNum,
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
  const { hour, minute, amount, active } = req.body || {};

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

      if (hour !== undefined) {
        if (!isInt(hour, 0, 23)) {
          return res.status(400).json({ success: false, error: 'Hora inválida (0-23)' });
        }
        updates.push('hour = ?'); values.push(hour);
      }
      if (minute !== undefined) {
        if (!isInt(minute, 0, 59)) {
          return res.status(400).json({ success: false, error: 'Minuto inválido (0-59)' });
        }
        updates.push('minute = ?'); values.push(minute);
      }
      if (amount !== undefined) {
        const amountNum = Number(amount);
        if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 2000) {
          return res.status(400).json({ success: false, error: 'Quantidade inválida (1-2000 g)' });
        }
        updates.push('amount = ?'); values.push(amountNum);
      }
      // Aceita tanto { days: {...} } quanto os booleanos soltos monday..sunday
      // (formato do modal de edição, que antes era silenciosamente ignorado).
      // Grava SEMPRE como JSON — antes gravava o valor cru e corrompia a coluna.
      const normalizedDays = normalizeDays(req.body);
      if (normalizedDays) {
        updates.push('days = ?'); values.push(JSON.stringify(normalizedDays));
      }
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
    mode: IS_PRODUCTION ? 'production' : 'development',
    database: `SQLite (${DB_PATH})`,
    transport: 'HTTP polling + WebSocket (/ws)',
    websocket: 'ativo',
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
app.get('/api/devices/:deviceId/commands', deviceAuth((r) => r.params.deviceId), (req, res) => {
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
app.post('/api/devices/:deviceId/status', deviceAuth((r) => r.params.deviceId), (req, res) => {
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
app.post('/api/feed/log', deviceAuth((r) => r.body.device_id), (req, res) => {
  const { device_id, size, steps, food_level_after, trigger, pet_name, offline, executed_at } = req.body;

  const isOffline = offline === true;
  const timestamp = executed_at || new Date().toISOString();

  console.log(`🍽️ Alimentação registrada: ${device_id} - ${size} - pet: ${pet_name || 'N/A'}`);

  // Buscar dispositivo primeiro.
  // IMPORTANTE: o firmware decide pelo código HTTP se apaga a alimentação da
  // fila offline. Qualquer falha precisa devolver 4xx/5xx — responder 200
  // fazia o ESP32 descartar registros que nunca foram gravados.
  db.get('SELECT id, user_id FROM devices WHERE device_id = ?', [device_id], (err, device) => {
    if (err) {
      console.error('[FEED/LOG] Erro ao buscar dispositivo:', err.message);
      return res.status(500).json({ success: false, message: 'Erro interno' });
    }
    if (!device) {
      console.log(`⚠️ Dispositivo ${device_id} não encontrado`);
      return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });
    }

    // Calcular gramas baseado no size
    const amounts = { small: 50, medium: 100, large: 150 };
    const amount = amounts[size] || 100;

    // Resolve o pet: primeiro pelo nome enviado pelo ESP32 e, se não achar
    // (caso comum: o pet foi renomeado no site), cai para o pet do dispositivo.
    const resolvePet = (cb) => {
      if (pet_name) {
        return db.get(
          'SELECT id, name FROM pets WHERE name = ? AND user_id = ?',
          [pet_name, device.user_id],
          (e, byName) => {
            if (!e && byName) return cb(byName);
            db.get('SELECT id, name FROM pets WHERE device_id = ?', [device.id], (e2, byDevice) => cb(byDevice || null));
          }
        );
      }
      db.get('SELECT id, name FROM pets WHERE device_id = ?', [device.id], (e, byDevice) => cb(byDevice || null));
    };

    resolvePet((pet) => {
      if (!pet) {
        // Não há pet cadastrado neste dispositivo: não existe onde registrar.
        // Responde 200 de propósito para o ESP32 não reter isso na fila para sempre.
        console.log(`⚠️ Nenhum pet cadastrado para ${device_id} — alimentação não registrada`);
        return res.json({ success: true, message: 'Nenhum pet cadastrado neste dispositivo' });
      }

      console.log(`✅ Pet resolvido: ${pet.name} (id: ${pet.id})`);

      // Registrar no histórico (usa timestamp offline se fornecido)
      // Se offline: scheduled vira scheduled_offline, outros triggers mantém o valor original
      let triggerType;
      if (isOffline) {
        triggerType = (trigger === 'scheduled') ? 'scheduled_offline' : (trigger || 'scheduled_offline');
      } else {
        triggerType = trigger || 'remote';
      }
      // A resposta só sai DEPOIS do INSERT: antes o 200 era enviado fora do
      // callback, então uma falha de gravação virava "salvo" para o ESP32.
      db.run(
        'INSERT INTO feeding_history (pet_id, device_id, amount, trigger_type, created_at) VALUES (?, ?, ?, ?, ?)',
        [pet.id, device.id, amount, triggerType, timestamp],
        function(err) {
          if (err) {
            console.error(`❌ Erro ao salvar histórico: ${err.message}`);
            return res.status(500).json({ success: false, message: 'Erro ao registrar alimentação' });
          }

          console.log(`📝 Histórico salvo: pet_id=${pet.id}, amount=${amount}g, trigger=${triggerType}`);

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
        }
      );
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

  // Confirmar que o dispositivo é deste usuário antes de expor o status
  db.get(
    'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?',
    [deviceId, req.userId],
    (err, device) => {
      if (err) return res.status(500).json({ success: false, message: 'Erro interno' });
      if (!device) return res.status(404).json({ success: false, message: 'Dispositivo não encontrado' });

      const status = deviceStatus.get(deviceId);
      if (!status) {
        return res.json({ success: true, data: { online: false, food_level: null, message: 'Dispositivo nunca conectou' } });
      }
      res.json({ success: true, data: status });
    }
  );
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

// ESP32 busca horários agendados (autenticado por X-Device-Secret)
app.get('/api/devices/:deviceId/schedules', deviceAuth((r) => r.params.deviceId), (req, res) => {
  const deviceId = req.params.deviceId;

  console.log(`📅 ESP32 ${deviceId} buscando horários...`);

  // Buscar dispositivo (incluindo power_save)
  db.get('SELECT id, user_id, power_save FROM devices WHERE device_id = ?', [deviceId], (err, device) => {
    // NUNCA responder 200 com lista vazia em caso de erro: o firmware trata
    // "success + data vazio" como "o usuário não tem horários" e APAGA os
    // horários gravados na flash. Erro tem que ser erro.
    if (err) {
      console.error('[SCHEDULES/ESP32] Erro ao buscar dispositivo:', err.message);
      return res.status(500).json({ success: false, error: 'Erro ao buscar dispositivo' });
    }
    if (!device) {
      return res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
    }

    // Horários DESTE dispositivo (via o pet vinculado a ele).
    // Antes filtrava só por dono: com dois alimentadores, cada um recebia os
    // horários de todos — o pet errado comia e o certo recebia dose dupla.
    // ORDER BY garante ordem estável para os logs do ESP32.
    db.all(
      `SELECT s.id, s.hour, s.minute, s.amount, s.days, s.active, p.name as pet_name
       FROM schedules s
       JOIN pets p ON s.pet_id = p.id
       WHERE p.user_id = ? AND p.device_id = ? AND s.active = 1
       ORDER BY s.hour, s.minute, s.id`,
      [device.user_id, device.id],
      (err, schedules) => {
        if (err) {
          console.error('[SCHEDULES/ESP32] Erro ao buscar horários:', err.message);
          return res.status(500).json({ success: false, error: 'Erro ao buscar horários' });
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
            // id estável: o firmware usa como chave da trava anti-reexecução,
            // para que dois pets no mesmo horário não se anulem.
            id: s.id,
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
// TRATAMENTO DE ERRO
// ========================================

// Middleware de erro do Express: qualquer exceção lançada em um handler cai
// aqui em vez de derrubar a requisição sem resposta.
app.use((err, req, res, next) => {
  console.error('[ERRO]', req.method, req.path, '-', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

// ========================================
// INICIALIZAÇÃO
// ========================================

server.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  PetFeeder Backend');
  console.log('========================================');
  console.log(`  HTTP      : http://localhost:${PORT}`);
  console.log(`  WebSocket : ws://localhost:${PORT}/ws`);
  console.log(`  Ambiente  : ${IS_PRODUCTION ? 'produção' : 'desenvolvimento'}`);
  console.log(`  Banco     : ${DB_PATH}`);
  console.log('========================================\n');
  console.log('✅ Servidor pronto!\n');
});

// Uma exceção/rejeição não tratada dentro de um callback do sqlite3 encerrava
// o processo silenciosamente — e cada queda apagava a fila de comandos, que só
// existe em memória. Aqui o erro é registrado e o encerramento é controlado.
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err && err.stack ? err.stack : err);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});

// Graceful shutdown — trata SIGTERM (o que o Docker envia) além de SIGINT.
// Fecha os clientes WebSocket explicitamente: sem isso wss.close() nunca
// completa enquanto houver um dashboard aberto e o processo trava até o SIGKILL.
let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 Encerrando servidor (${signal})...`);

  const forceExit = setTimeout(() => {
    console.warn('⚠️  Encerramento forçado (timeout)');
    process.exit(exitCode);
  }, 8000);
  forceExit.unref();

  server.close(() => console.log('✅ HTTP Server fechado'));

  wss.clients.forEach((client) => {
    try { client.close(1001, 'Servidor encerrando'); } catch (e) { /* ignora */ }
  });
  wss.close(() => console.log('✅ WebSocket fechado'));

  db.close((err) => {
    if (err) console.error('Erro ao fechar banco:', err.message);
    else console.log('✅ Banco fechado');
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig, 0)));
