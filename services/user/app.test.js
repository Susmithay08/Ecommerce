const request = require('supertest');
const mongoose = require('mongoose');

// Mock environment
process.env.MONGO_URI = 'mongodb://localhost:27017/test_users';
process.env.JWT_SECRET = 'test_secret';

const app = require('./app');

describe('User Service', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/register')
        .send({ name: 'Test User', email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('test@example.com');
      expect(res.body.password).toBeUndefined();
    });

    it('should reject duplicate email', async () => {
      const res = await request(app)
        .post('/register')
        .send({ name: 'Test User 2', email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(409);
    });

    it('should validate email format', async () => {
      const res = await request(app)
        .post('/register')
        .send({ name: 'Test', email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(400);
    });

    it('should require password minimum length', async () => {
      const res = await request(app)
        .post('/register')
        .send({ name: 'Test', email: 'new@example.com', password: '123' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('test@example.com');
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /profile', () => {
    let token;

    beforeAll(async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'password123' });
      token = res.body.token;
    });

    it('should return user profile with valid token', async () => {
      const res = await request(app)
        .get('/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
      expect(res.body.password).toBeUndefined();
    });

    it('should reject request without token', async () => {
      const res = await request(app).get('/profile');
      expect(res.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/profile')
        .set('Authorization', 'Bearer invalid_token');

      expect(res.status).toBe(401);
    });
  });
});
