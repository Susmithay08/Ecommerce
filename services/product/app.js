const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const winston = require('winston');

const app = express();
app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/products', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => logger.info('Connected to MongoDB'));

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  description: String,
  price: { type: Number, required: true, min: 0 },
  category: { type: String, required: true, index: true },
  tags: [String],
  images: [String],
  inventory: {
    quantity: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0 }
  },
  sku: { type: String, unique: true },
  isActive: { type: Boolean, default: true },
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

productSchema.index({ name: 'text', description: 'text' });
const Product = mongoose.model('Product', productSchema);

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

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'product-service' }));

// List Products (public)
app.get('/', async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, page = 1, limit = 20, sort = 'createdAt' } = req.query;
    const query = { isActive: true };

    if (category) query.category = category;
    if (minPrice || maxPrice) query.price = {};
    if (minPrice) query.price.$gte = Number(minPrice);
    if (maxPrice) query.price.$lte = Number(maxPrice);
    if (search) query.$text = { $search: search };

    const skip = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(Number(limit)),
      Product.countDocuments(query)
    ]);

    res.json({ products, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('List products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Single Product (public)
app.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product || !product.isActive) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Product (admin)
app.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    logger.info(`Product created: ${product._id}`);
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Product (admin)
app.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Product (admin)
app.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Inventory (internal use / admin)
app.patch('/:id/inventory', authenticate, async (req, res) => {
  try {
    const { quantity, operation } = req.body; // operation: 'add' | 'subtract' | 'reserve'
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    if (operation === 'subtract') {
      if (product.inventory.quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });
      product.inventory.quantity -= quantity;
    } else if (operation === 'add') {
      product.inventory.quantity += quantity;
    } else if (operation === 'reserve') {
      if (product.inventory.quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });
      product.inventory.quantity -= quantity;
      product.inventory.reserved += quantity;
    }

    await product.save();
    res.json({ inventory: product.inventory });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Categories (public)
app.get('/meta/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category', { isActive: true });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => logger.info(`Product Service running on port ${PORT}`));

module.exports = app;
