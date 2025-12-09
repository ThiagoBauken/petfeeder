const express = require('express');
const authRoutes = require('./auth');
const devicesRoutes = require('./devices');
const petsRoutes = require('./pets');
const feedRoutes = require('./feed');

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'PetFeeder Backend API',
    version: '1.0.0',
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/devices', devicesRoutes);
router.use('/pets', petsRoutes);
router.use('/feed', feedRoutes);

// API info endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PetFeeder SaaS API',
    version: '1.0.0',
    documentation: '/api-docs',
    endpoints: {
      auth: '/api/auth',
      devices: '/api/devices',
      pets: '/api/pets',
      feed: '/api/feed',
    },
  });
});

module.exports = router;
