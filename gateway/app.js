const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const winston = require('winston');

const app = express();

const path = require('path');

app.use('/images', express.static(path.join(__dirname, 'public/images')));


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

// Service URLs
const SERVICES = {
  user: process.env.USER_SERVICE_URL || 'http://user-service:3001',
  product: process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002',
  cart: process.env.CART_SERVICE_URL || 'http://cart-service:3003',
  order: process.env.ORDER_SERVICE_URL || 'http://order-service:3004',
  payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3005',
  notify: process.env.NOTIFY_SERVICE_URL || 'http://notification-service:3006'
};

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('combined'));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' }
});

app.use(limiter);

// JWT Validation Middleware
const validateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Proxy Options Factory
const proxyOptions = (target, pathRewrite = {}) => ({
  target,
  changeOrigin: true,
  pathRewrite,
  on: {
    error: (err, req, res) => {
      logger.error(`Proxy error to ${target}:`, err.message);
      res.status(502).json({ error: 'Service temporarily unavailable' });
    },
    proxyReq: (proxyReq, req) => {
      // Forward user info if authenticated
      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role);
        proxyReq.setHeader('X-User-Email', req.user.email);
      }
      logger.info(`Proxying ${req.method} ${req.path} -> ${target}`);
    }
  }
});

// ─── Routes ────────────────────────────────────────────────────────────────

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// Check all service health
app.get('/health/all', async (req, res) => {
  const axios = require('axios');
  const results = {};
  for (const [name, url] of Object.entries(SERVICES)) {
    try {
      const r = await axios.get(`${url}/health`, { timeout: 2000 });
      results[name] = r.data;
    } catch {
      results[name] = { status: 'unavailable' };
    }
  }
  res.json(results);
});

// User Service – public routes
app.post('/api/auth/register', authLimiter,
  createProxyMiddleware(proxyOptions(SERVICES.user, { '/api/auth/register': '/register' }))
);
app.post('/api/auth/login', authLimiter,
  createProxyMiddleware(proxyOptions(SERVICES.user, { '/api/auth/login': '/login' }))
);

// User Service – protected routes
app.use('/api/users',
  validateToken,
  createProxyMiddleware(proxyOptions(SERVICES.user, { '/api/users': '' }))
);

// Product Service – public GET, protected mutations
app.get('/api/products*',
  createProxyMiddleware(proxyOptions(SERVICES.product, { '/api/products': '' }))
);
app.use('/api/products',
  validateToken,
  createProxyMiddleware(proxyOptions(SERVICES.product, { '/api/products': '' }))
);

// Cart Service – protected
app.use('/api/cart',
  validateToken,
  createProxyMiddleware(proxyOptions(SERVICES.cart, { '/api/cart': '' }))
);

// Order Service – protected
app.use('/api/orders',
  validateToken,
  createProxyMiddleware(proxyOptions(SERVICES.order, { '/api/orders': '' }))
);

// Payment Service – protected
app.use('/api/payments',
  validateToken,
  createProxyMiddleware(proxyOptions(SERVICES.payment, { '/api/payments': '' }))
);

// Stripe Webhook – no auth
app.post('/api/payments/webhook',
  createProxyMiddleware(proxyOptions(SERVICES.payment, { '/api/payments/webhook': '/webhook' }))
);

// Notification Service – admin only
app.use('/api/notifications',
  validateToken,
  (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  createProxyMiddleware(proxyOptions(SERVICES.notify, { '/api/notifications': '' }))
);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
  logger.info('Service routing:', SERVICES);
});

module.exports = app;
