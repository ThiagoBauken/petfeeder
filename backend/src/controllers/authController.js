const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { query, transaction } = require('../config/database');
const { redis } = require('../config/redis');
const config = require('../config');
const logger = require('../utils/logger');

class AuthController {
  // Register new user
  async register(req, res, next) {
    try {
      const { email, password, name, timezone } = req.body;

      // Check if user already exists
      const existingUser = await query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered',
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const result = await query(
        `INSERT INTO users (email, password_hash, name, plan, timezone, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, email, name, plan, timezone, created_at`,
        [email, hashedPassword, name, 'free', timezone || config.timezone]
      );

      const user = result.rows[0];

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user);

      // Store refresh token in Redis
      await redis.set(`refresh:${user.id}`, refreshToken, 7 * 24 * 60 * 60); // 7 days

      logger.info('User registered', { userId: user.id, email: user.email });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
          },
          accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      logger.error('Registration error', error);
      next(error);
    }
  }

  // Login
  async login(req, res, next) {
    try {
      const { email, password, totpToken } = req.body;

      // Get user
      const result = await query(
        `SELECT id, email, name, password_hash, plan, two_factor_enabled, two_factor_secret,
                stripe_customer_id, timezone, last_login
         FROM users
         WHERE email = $1 AND deleted_at IS NULL`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      const user = result.rows[0];

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // Check 2FA if enabled
      if (user.two_factor_enabled) {
        if (!totpToken) {
          return res.status(401).json({
            success: false,
            message: '2FA token required',
            requiresTwoFactor: true,
          });
        }

        const validToken = speakeasy.totp.verify({
          secret: user.two_factor_secret,
          encoding: 'base32',
          token: totpToken,
          window: config.twoFactor.window,
        });

        if (!validToken) {
          return res.status(401).json({
            success: false,
            message: 'Invalid 2FA token',
          });
        }
      }

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user);

      // Store refresh token
      await redis.set(`refresh:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

      // Update last login
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      logger.info('User logged in', { userId: user.id, email: user.email });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
            twoFactorEnabled: user.two_factor_enabled,
          },
          accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      logger.error('Login error', error);
      next(error);
    }
  }

  // Refresh access token
  async refresh(req, res, next) {
    try {
      const userId = req.user.id;

      // Get user
      const result = await query(
        'SELECT id, email, name, plan FROM users WHERE id = $1 AND deleted_at IS NULL',
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
        });
      }

      const user = result.rows[0];

      // Generate new access token
      const accessToken = this.generateAccessToken(user);

      res.json({
        success: true,
        data: {
          accessToken,
        },
      });
    } catch (error) {
      logger.error('Token refresh error', error);
      next(error);
    }
  }

  // Logout
  async logout(req, res, next) {
    try {
      const userId = req.user.id;
      const token = req.headers.authorization?.substring(7);

      // Blacklist current token
      if (token) {
        await redis.set(`blacklist:${token}`, 'true', 15 * 60); // 15 min (token expiry)
      }

      // Delete refresh token
      await redis.del(`refresh:${userId}`);

      logger.info('User logged out', { userId });

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      logger.error('Logout error', error);
      next(error);
    }
  }

  // Enable 2FA
  async enable2FA(req, res, next) {
    try {
      const userId = req.user.id;

      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `${config.twoFactor.issuer} (${req.user.email})`,
        issuer: config.twoFactor.issuer,
      });

      // Generate QR code
      const qrCode = await QRCode.toDataURL(secret.otpauth_url);

      // Store secret temporarily (not enabled yet)
      await redis.set(`2fa_pending:${userId}`, secret.base32, 600); // 10 min

      res.json({
        success: true,
        data: {
          secret: secret.base32,
          qrCode,
          message: 'Scan QR code with authenticator app and verify',
        },
      });
    } catch (error) {
      logger.error('2FA enable error', error);
      next(error);
    }
  }

  // Verify and confirm 2FA
  async verify2FA(req, res, next) {
    try {
      const userId = req.user.id;
      const { token } = req.body;

      // Get pending secret
      const secret = await redis.get(`2fa_pending:${userId}`);
      if (!secret) {
        return res.status(400).json({
          success: false,
          message: '2FA setup expired, please try again',
        });
      }

      // Verify token
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: config.twoFactor.window,
      });

      if (!verified) {
        return res.status(400).json({
          success: false,
          message: 'Invalid token',
        });
      }

      // Enable 2FA
      await query(
        'UPDATE users SET two_factor_enabled = true, two_factor_secret = $1 WHERE id = $2',
        [secret, userId]
      );

      // Delete pending secret
      await redis.del(`2fa_pending:${userId}`);

      logger.info('2FA enabled', { userId });

      res.json({
        success: true,
        message: '2FA enabled successfully',
      });
    } catch (error) {
      logger.error('2FA verification error', error);
      next(error);
    }
  }

  // Disable 2FA
  async disable2FA(req, res, next) {
    try {
      const userId = req.user.id;
      const { password } = req.body;

      // Verify password
      const result = await query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      const validPassword = await bcrypt.compare(password, result.rows[0].password_hash);
      if (!validPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password',
        });
      }

      // Disable 2FA
      await query(
        'UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1',
        [userId]
      );

      logger.info('2FA disabled', { userId });

      res.json({
        success: true,
        message: '2FA disabled successfully',
      });
    } catch (error) {
      logger.error('2FA disable error', error);
      next(error);
    }
  }

  // Get current user
  async getMe(req, res, next) {
    try {
      const userId = req.user.id;

      const result = await query(
        `SELECT id, email, name, plan, timezone, two_factor_enabled,
                stripe_customer_id, created_at, last_login
         FROM users
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Get user error', error);
      next(error);
    }
  }

  // Get device token for ESP32 configuration
  async getDeviceToken(req, res, next) {
    try {
      const userId = req.user.id;

      // O token do dispositivo e simplesmente o ID do usuario
      // O ESP32 vai usar esse token para se registrar

      res.json({
        success: true,
        data: {
          deviceToken: userId,
          instructions: [
            '1. Ligue o ESP32',
            '2. Conecte na rede WiFi: PetFeeder_XXXXXX',
            '3. Acesse: http://192.168.4.1',
            '4. Cole este token no campo "Token do Usuario"',
            '5. Preencha os dados do WiFi e clique Salvar',
          ],
        },
      });
    } catch (error) {
      logger.error('Get device token error', error);
      next(error);
    }
  }

  // Helper: Generate tokens
  generateTokens(user) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        plan: user.plan,
      },
      config.security.jwt.refreshSecret,
      { expiresIn: config.security.jwt.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
  }

  // Helper: Generate access token
  generateAccessToken(user) {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        plan: user.plan,
      },
      config.security.jwt.secret,
      { expiresIn: config.security.jwt.expiresIn }
    );
  }
}

module.exports = new AuthController();
