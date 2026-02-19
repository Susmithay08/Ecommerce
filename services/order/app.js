const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const amqp = require('amqplib');
const winston = require('winston');

const app = express();
app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/orders', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => logger.info('Connected to MongoDB'));

// Order Schema
const orderSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  items: [{
    productId: String,
    name: String,
    price: Number,
    quantity: Number,
    subtotal: Number
  }],
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending',
    index: true
  },
  shipping: {
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: String
    },
    method: String,
    trackingNumber: String,
    estimatedDelivery: Date
  },
  payment: {
    method: String,
    transactionId: String,
    status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    amount: Number
  },
  subtotal: Number,
  tax: Number,
  shippingCost: Number,
  total: Number,
  notes: String,
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

// RabbitMQ Publisher
let channel;
async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672');
    channel = await connection.createChannel();
    await channel.assertExchange('events', 'topic', { durable: true });
    // Create queue for order service
    const q = await channel.assertQueue('order-service-queue', { durable: true });

    // Listen for payment events
    await channel.bindQueue(q.queue, 'events', 'payment.succeeded');
    await channel.bindQueue(q.queue, 'events', 'payment.failed');
    await channel.bindQueue(q.queue, 'events', 'payment.refunded');

    channel.consume(q.queue, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const data = JSON.parse(msg.content.toString());

      try {
        const order = await Order.findById(data.orderId);
        if (!order) {
          channel.ack(msg);
          return;
        }

        if (routingKey === 'payment.succeeded') {
          order.status = 'confirmed';
          order.payment.status = 'paid';
          order.payment.transactionId = data.paymentId;
          order.statusHistory.push({ status: 'confirmed', note: 'Payment successful' });
        }

        if (routingKey === 'payment.failed') {
          order.payment.status = 'failed';
          order.statusHistory.push({ status: 'pending', note: 'Payment failed' });
        }

        if (routingKey === 'payment.refunded') {
          order.status = 'refunded';
          order.payment.status = 'refunded';
          order.statusHistory.push({ status: 'refunded', note: 'Payment refunded' });
        }

        order.updatedAt = Date.now();
        await order.save();

        logger.info(`Order updated from event: ${routingKey}`);
        channel.ack(msg);

      } catch (err) {
        logger.error('Order event handling error:', err);
        channel.nack(msg, false, false);
      }
    });

    logger.info('Connected to RabbitMQ');
  } catch (err) {
    logger.error('RabbitMQ connection error:', err);
    setTimeout(connectRabbitMQ, 5000);
  }
}
connectRabbitMQ();

const publishEvent = (routingKey, data) => {
  if (channel) {
    channel.publish('events', routingKey, Buffer.from(JSON.stringify(data)), { persistent: true });
    logger.info(`Event published: ${routingKey}`);
  }
};

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

// Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

// Place Order
app.post('/', authenticate, async (req, res) => {
  try {
    const { items, shipping, paymentMethod, notes } = req.body;

    if (!items?.length) return res.status(400).json({ error: 'No items in order' });

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = subtotal * 0.1;
    const shippingCost = subtotal > 100 ? 0 : 9.99;
    const total = subtotal + tax + shippingCost;

    const orderItems = items.map(item => ({
      ...item,
      subtotal: item.price * item.quantity
    }));

    const order = await Order.create({
      userId: req.user.id,
      items: orderItems,
      shipping,
      payment: { method: paymentMethod, amount: total },
      subtotal,
      tax,
      shippingCost,
      total,
      notes,
      statusHistory: [{ status: 'pending', note: 'Order placed' }]
    });

    // Publish order.created event
    publishEvent('order.created', {
      orderId: order._id,
      userId: req.user.id,
      total,
      items: orderItems
    });

    logger.info(`Order created: ${order._id} for user: ${req.user.id}`);
    res.status(201).json(order);
  } catch (err) {
    logger.error('Create order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get User Orders
app.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = { userId: req.user.id };
    if (status) query.status = status;

    const [orders, total] = await Promise.all([
      Order.find(query).sort('-createdAt').skip((page - 1) * limit).limit(Number(limit)),
      Order.countDocuments(query)
    ]);

    res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Single Order
app.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Order Status (admin)
app.patch('/:id/status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { status, note, trackingNumber } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.status = status;
    order.statusHistory.push({ status, note });
    if (trackingNumber) order.shipping.trackingNumber = trackingNumber;
    order.updatedAt = Date.now();
    await order.save();

    publishEvent('order.status_updated', {
      orderId: order._id,
      userId: order.userId,
      status,
      trackingNumber
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel Order
app.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
    }

    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', note: req.body.reason || 'Cancelled by user' });
    await order.save();

    publishEvent('order.cancelled', { orderId: order._id, userId: req.user.id });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => logger.info(`Order Service running on port ${PORT}`));

module.exports = app;
