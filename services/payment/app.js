const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const amqp = require('amqplib');
const winston = require('winston');

const app = express();

// Stripe webhook needs raw body
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/payments', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => logger.info('Connected to MongoDB'));

// Payment Schema
const paymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  provider: { type: String, default: 'stripe' },
  providerPaymentId: String,
  providerCustomerId: String,
  paymentMethod: String,
  metadata: mongoose.Schema.Types.Mixed,
  failureReason: String,
  refundId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);

// RabbitMQ
let channel;
async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672');
    channel = await connection.createChannel();
    await channel.assertExchange('events', 'topic', { durable: true });
    logger.info('Connected to RabbitMQ');
  } catch (err) {
    logger.error('RabbitMQ error:', err);
    setTimeout(connectRabbitMQ, 5000);
  }
}
connectRabbitMQ();

const publishEvent = (routingKey, data) => {
  if (channel) {
    channel.publish('events', routingKey, Buffer.from(JSON.stringify(data)), { persistent: true });
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
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payment-service' }));

// Create Payment Intent
app.post('/intent', authenticate, async (req, res) => {
  try {
    const { orderId, amount, currency = 'usd' } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency,
      metadata: { orderId, userId: req.user.id }
    });

    const payment = await Payment.create({
      orderId,
      userId: req.user.id,
      amount,
      currency,
      providerPaymentId: paymentIntent.id,
      status: 'pending'
    });

    logger.info(`Payment intent created: ${payment._id}`);
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentId: payment._id
    });
  } catch (err) {
    logger.error('Create payment intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm Payment
app.post('/:id/confirm', authenticate, async (req, res) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, userId: req.user.id });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const paymentIntent = await stripe.paymentIntents.retrieve(payment.providerPaymentId);
    
    if (paymentIntent.status === 'succeeded') {
      payment.status = 'succeeded';
      payment.paymentMethod = paymentIntent.payment_method;
      payment.updatedAt = Date.now();
      await payment.save();

      publishEvent('payment.succeeded', {
        paymentId: payment._id,
        orderId: payment.orderId,
        userId: payment.userId,
        amount: payment.amount
      });

      logger.info(`Payment succeeded: ${payment._id}`);
      res.json({ status: 'succeeded', payment });
    } else {
      payment.status = 'failed';
      payment.failureReason = paymentIntent.last_payment_error?.message;
      await payment.save();

      publishEvent('payment.failed', {
        paymentId: payment._id,
        orderId: payment.orderId,
        userId: payment.userId
      });

      res.status(400).json({ status: 'failed', error: payment.failureReason });
    }
  } catch (err) {
    logger.error('Confirm payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refund Payment
app.post('/:id/refund', authenticate, async (req, res) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, userId: req.user.id });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'succeeded') return res.status(400).json({ error: 'Payment cannot be refunded' });

    const refund = await stripe.refunds.create({
      payment_intent: payment.providerPaymentId,
      amount: req.body.amount ? Math.round(req.body.amount * 100) : undefined
    });

    payment.status = 'refunded';
    payment.refundId = refund.id;
    payment.updatedAt = Date.now();
    await payment.save();

    publishEvent('payment.refunded', {
      paymentId: payment._id,
      orderId: payment.orderId,
      userId: payment.userId,
      amount: refund.amount / 100
    });

    res.json({ status: 'refunded', refundId: refund.id });
  } catch (err) {
    logger.error('Refund error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Payment History
app.get('/', authenticate, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user.id }).sort('-createdAt');
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stripe Webhook
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    logger.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      logger.info(`Webhook: payment_intent.succeeded ${event.data.object.id}`);
      break;
    case 'payment_intent.payment_failed':
      logger.info(`Webhook: payment_intent.payment_failed ${event.data.object.id}`);
      break;
    default:
      logger.info(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => logger.info(`Payment Service running on port ${PORT}`));

module.exports = app;
