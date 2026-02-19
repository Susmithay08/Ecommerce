const express = require('express');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const winston = require('winston');

const app = express();
app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

// Redis Client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.connect()
  .then(() => logger.info('Connected to Redis'))
  .catch(err => logger.error('Redis connection error:', err));

const CART_TTL = 60 * 60 * 24 * 7; // 7 days

// Auth Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const getCartKey = (userId) => `cart:${userId}`;

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'cart-service' }));

// Get Cart
app.get('/', authenticate, async (req, res) => {
  try {
    const data = await redisClient.get(getCartKey(req.user.id));
    const cart = data ? JSON.parse(data) : { items: [], total: 0, itemCount: 0 };
    res.json(cart);
  } catch (err) {
    logger.error('Get cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add Item to Cart
app.post('/items', authenticate, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId || quantity < 1) return res.status(400).json({ error: 'Invalid item data' });

    // Fetch product details
    let product;
    try {
      const response = await axios.get(
        `${process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002'}/${productId}`
      );
      product = response.data;
    } catch {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.inventory.quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const cartKey = getCartKey(req.user.id);
    const data = await redisClient.get(cartKey);
    const cart = data ? JSON.parse(data) : { items: [] };

    const existingIndex = cart.items.findIndex(i => i.productId === productId);
    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += quantity;
    } else {
      cart.items.push({
        productId,
        name: product.name,
        price: product.price,
        image: product.images?.[0],
        quantity
      });
    }

    cart.total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    cart.itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.updatedAt = new Date().toISOString();

    await redisClient.setEx(cartKey, CART_TTL, JSON.stringify(cart));
    logger.info(`Cart updated for user: ${req.user.id}`);
    res.json(cart);
  } catch (err) {
    logger.error('Add to cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Item Quantity
app.put('/items/:productId', authenticate, async (req, res) => {
  try {
    const { quantity } = req.body;
    const { productId } = req.params;

    const cartKey = getCartKey(req.user.id);
    const data = await redisClient.get(cartKey);
    if (!data) return res.status(404).json({ error: 'Cart not found' });

    const cart = JSON.parse(data);
    const itemIndex = cart.items.findIndex(i => i.productId === productId);
    if (itemIndex < 0) return res.status(404).json({ error: 'Item not in cart' });

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      cart.items[itemIndex].quantity = quantity;
    }

    cart.total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    cart.itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.updatedAt = new Date().toISOString();

    await redisClient.setEx(cartKey, CART_TTL, JSON.stringify(cart));
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove Item
app.delete('/items/:productId', authenticate, async (req, res) => {
  try {
    const { productId } = req.params;
    const cartKey = getCartKey(req.user.id);
    const data = await redisClient.get(cartKey);
    if (!data) return res.status(404).json({ error: 'Cart not found' });

    const cart = JSON.parse(data);
    cart.items = cart.items.filter(i => i.productId !== productId);
    cart.total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    cart.itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    await redisClient.setEx(cartKey, CART_TTL, JSON.stringify(cart));
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear Cart
app.delete('/', authenticate, async (req, res) => {
  try {
    await redisClient.del(getCartKey(req.user.id));
    res.json({ message: 'Cart cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => logger.info(`Cart Service running on port ${PORT}`));

module.exports = app;
