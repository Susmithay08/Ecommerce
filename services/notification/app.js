const express = require('express');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const winston = require('winston');

const app = express();
app.use(express.json());

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

// Email Transporter (configure with real SMTP/SendGrid in production)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER || 'apikey',
    pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY || 'placeholder'
  }
});

// Email Templates
const templates = {
  orderConfirmation: (data) => ({
    subject: `Order Confirmed - #${data.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Order Confirmed! 🎉</h1>
        <p>Thank you for your order. Your order #<strong>${data.orderId}</strong> has been confirmed.</p>
        <h2>Order Summary</h2>
        <table style="width:100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 10px; text-align: left;">Item</th>
              <th style="padding: 10px; text-align: right;">Qty</th>
              <th style="padding: 10px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${data.items?.map(item => `
              <tr>
                <td style="padding: 10px;">${item.name}</td>
                <td style="padding: 10px; text-align: right;">${item.quantity}</td>
                <td style="padding: 10px; text-align: right;">$${item.price.toFixed(2)}</td>
              </tr>
            `).join('') || ''}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding: 10px; text-align: right;"><strong>Total:</strong></td>
              <td style="padding: 10px; text-align: right;"><strong>$${data.total?.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
        <p>We'll send you another email when your order ships.</p>
        <p>Thank you for shopping with us!</p>
      </div>
    `
  }),

  orderShipped: (data) => ({
    subject: `Your Order Has Shipped - #${data.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Your Order is on the Way! 📦</h1>
        <p>Great news! Order #<strong>${data.orderId}</strong> has been shipped.</p>
        ${data.trackingNumber ? `
          <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong>Tracking Number:</strong> ${data.trackingNumber}
          </div>
        ` : ''}
        <p>Estimated delivery: ${data.estimatedDelivery || '3-5 business days'}</p>
      </div>
    `
  }),

  orderCancelled: (data) => ({
    subject: `Order Cancelled - #${data.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e53e3e;">Order Cancelled</h1>
        <p>Your order #<strong>${data.orderId}</strong> has been cancelled.</p>
        <p>If you have any questions, please contact our support team.</p>
      </div>
    `
  }),

  paymentSucceeded: (data) => ({
    subject: `Payment Confirmed - $${data.amount}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #38a169;">Payment Successful ✓</h1>
        <p>Your payment of <strong>$${data.amount?.toFixed(2)}</strong> has been processed successfully.</p>
        <p>Order ID: #${data.orderId}</p>
      </div>
    `
  })
};

async function sendEmail(to, template) {
  if (!to || !process.env.SMTP_PASS) {
    logger.warn(`Email not sent (no config): ${template.subject}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || 'noreply@ecommerce.com',
      to,
      subject: template.subject,
      html: template.html
    });
    logger.info(`Email sent to ${to}: ${template.subject}`);
  } catch (err) {
    logger.error('Email send error:', err);
  }
}

// RabbitMQ Consumer
async function startConsumer() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672');
    const channel = await connection.createChannel();

    await channel.assertExchange('events', 'topic', { durable: true });
    const q = await channel.assertQueue('notification-queue', { durable: true });

    // Bind to relevant events
    const bindings = ['order.created', 'order.status_updated', 'order.cancelled', 'payment.succeeded', 'payment.failed', 'payment.refunded'];
    for (const key of bindings) {
      await channel.bindQueue(q.queue, 'events', key);
    }

    logger.info('Notification service listening for events...');

    channel.consume(q.queue, async (msg) => {
      if (!msg) return;

      try {
        const routingKey = msg.fields.routingKey;
        const data = JSON.parse(msg.content.toString());
        logger.info(`Received event: ${routingKey}`, data);

        // In production, fetch user email from user-service
        const userEmail = data.userEmail || `user-${data.userId}@example.com`;

        switch (routingKey) {
          case 'order.created':
            await sendEmail(userEmail, templates.orderConfirmation(data));
            break;
          case 'order.status_updated':
            if (data.status === 'shipped') {
              await sendEmail(userEmail, templates.orderShipped(data));
            }
            break;
          case 'order.cancelled':
            await sendEmail(userEmail, templates.orderCancelled(data));
            break;
          case 'payment.succeeded':
            await sendEmail(userEmail, templates.paymentSucceeded(data));
            break;
        }

        channel.ack(msg);
      } catch (err) {
        logger.error('Event processing error:', err);
        channel.nack(msg, false, true); // requeue
      }
    });
  } catch (err) {
    logger.error('RabbitMQ consumer error:', err);
    setTimeout(startConsumer, 5000);
  }
}

startConsumer();

// REST API for manual notifications (admin use)
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));

app.post('/send', async (req, res) => {
  try {
    const { to, type, data } = req.body;
    const template = templates[type]?.(data);
    if (!template) return res.status(400).json({ error: 'Unknown template type' });
    await sendEmail(to, template);
    res.json({ message: 'Notification sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => logger.info(`Notification Service running on port ${PORT}`));
