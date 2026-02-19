# 🛒 E-Commerce Microservices Platform

A production-ready, scalable e-commerce platform built with Node.js microservices, Docker, and modern DevOps tooling.

## Architecture Overview

```
                           ┌─────────────────────────────────┐
                           │         Client (Browser/App)    │
                           └──────────────┬──────────────────┘
                                          │ HTTPS
                           ┌──────────────▼──────────────────┐
                           │         API Gateway :3000        │
                           │  Rate Limiting · CORS · Auth    │
                           └──┬──────┬──────┬──────┬─────────┘
                              │      │      │      │
               ┌──────────────▼─┐  ┌─▼──┐  │   ┌──▼──────────┐
               │ User Service   │  │Cart│  │   │Product Svc  │
               │    :3001       │  │:3003│  │   │   :3002 x2  │
               └──────────────┬─┘  └─┬──┘  │   └──────────────┘
                              │      │     │
                    ┌─────────▼──────▼─────▼─────────┐
                    │           MongoDB               │
                    │  users · products · orders      │
                    │           payments              │
                    └─────────────────────────────────┘
                              │
               ┌──────────────▼──────────────────────┐
               │           RabbitMQ (Events)          │
               │  order.created · payment.succeeded   │
               └──────┬──────────────────┬────────────┘
                      │                  │
          ┌───────────▼────┐   ┌─────────▼──────────┐
          │ Order Service  │   │ Notification Svc   │
          │    :3004       │   │     :3006           │
          └───────────┬────┘   └────────────────────┘
                      │
          ┌───────────▼────────┐
          │  Payment Service   │
          │     :3005          │
          │    ↕ Stripe API    │
          └────────────────────┘
```

## Services

| Service | Port | Description | Storage |
|---------|------|-------------|---------|
| **API Gateway** | 3000 | Request routing, rate limiting, auth | — |
| **User Service** | 3001 | Auth, registration, profiles | MongoDB |
| **Product Service** | 3002 | Catalog, inventory (scalable) | MongoDB |
| **Cart Service** | 3003 | Session carts | Redis |
| **Order Service** | 3004 | Order lifecycle | MongoDB |
| **Payment Service** | 3005 | Stripe integration, refunds | MongoDB |
| **Notification Service** | 3006 | Email via SendGrid/SMTP | — |

## Infrastructure

| Component | Port | Purpose |
|-----------|------|---------|
| MongoDB | 27017 | Primary database |
| Redis | 6379 | Cart sessions, caching |
| RabbitMQ | 5672 / 15672 | Async event bus |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3100 | Metrics dashboards |
| Elasticsearch | 9200 | Log storage |
| Kibana | 5601 | Log visualization |

## Quick Start

### Prerequisites
- Docker & Docker Compose v2
- Node.js 18+ (for local development)
- Git

### 1. Clone & Configure

```bash
git clone https://github.com/yourorg/ecommerce-platform.git
cd ecommerce-platform

# Set up environment
cp .env.example .env
# Edit .env with your actual values
```

### 2. Start the Platform

**Development mode** (hot reload, debug UIs):
```bash
./scripts/manage.sh start:dev
```

**Production mode**:
```bash
./scripts/manage.sh start:prod
```

### 3. Verify Everything is Running

```bash
./scripts/manage.sh health
```

## API Reference

### Authentication

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Doe", "email": "jane@example.com", "password": "securepass123"}'

# Login → returns JWT token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "jane@example.com", "password": "securepass123"}'

# Use token in subsequent requests
export TOKEN="eyJhbGci..."
```

### Products

```bash
# Browse products
curl http://localhost:3000/api/products

# Filter by category & price
curl "http://localhost:3000/api/products?category=Electronics&minPrice=50&maxPrice=200"

# Search
curl "http://localhost:3000/api/products?search=wireless+headphones"

# Get single product
curl http://localhost:3000/api/products/{productId}
```

### Cart

```bash
# Add item
curl -X POST http://localhost:3000/api/cart/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productId": "...", "quantity": 2}'

# View cart
curl http://localhost:3000/api/cart -H "Authorization: Bearer $TOKEN"

# Update quantity
curl -X PUT http://localhost:3000/api/cart/items/{productId} \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"quantity": 3}'

# Remove item
curl -X DELETE http://localhost:3000/api/cart/items/{productId} \
  -H "Authorization: Bearer $TOKEN"
```

### Orders

```bash
# Place order
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"productId": "...", "name": "Headphones", "price": 149.99, "quantity": 1}],
    "shipping": {"address": {"street": "123 Main St", "city": "Austin", "state": "TX", "zip": "78701", "country": "US"}},
    "paymentMethod": "card"
  }'

# View order history
curl http://localhost:3000/api/orders -H "Authorization: Bearer $TOKEN"
```

### Payments

```bash
# Create payment intent
curl -X POST http://localhost:3000/api/payments/intent \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"orderId": "...", "amount": 149.99}'

# Response includes Stripe clientSecret for frontend SDK
```

## Management Commands

```bash
./scripts/manage.sh start:dev    # Start in dev mode
./scripts/manage.sh start:prod   # Start in production mode
./scripts/manage.sh stop         # Stop all services
./scripts/manage.sh status       # Container status
./scripts/manage.sh health       # Check all health endpoints
./scripts/manage.sh logs         # All logs (stream)
./scripts/manage.sh logs order-service  # Single service logs
./scripts/manage.sh restart product-service  # Restart one service
./scripts/manage.sh build        # Rebuild images
./scripts/manage.sh clean        # Destroy everything (careful!)
```

## Scaling

### Scale horizontally with Docker Compose:
```bash
docker compose up -d --scale product-service=4
```

### Deploy to Kubernetes:
```bash
kubectl apply -f k8s/deployment.yml

# Watch pods
kubectl get pods -n ecommerce -w

# HPA auto-scales product-service based on CPU/memory
kubectl get hpa -n ecommerce
```

## Event System

Services communicate asynchronously via RabbitMQ:

| Event | Publisher | Consumers |
|-------|-----------|-----------|
| `order.created` | Order Service | Notification, Payment |
| `order.status_updated` | Order Service | Notification |
| `order.cancelled` | Order Service | Notification, Payment |
| `payment.succeeded` | Payment Service | Order, Notification |
| `payment.failed` | Payment Service | Order, Notification |
| `payment.refunded` | Payment Service | Order, Notification |

## Monitoring

| Tool | URL | Credentials |
|------|-----|-------------|
| Grafana Dashboards | http://localhost:3100 | admin / grafanapass |
| Prometheus | http://localhost:9090 | — |
| RabbitMQ Management | http://localhost:15672 | admin / rabbitpass |
| Kibana Logs | http://localhost:5601 | — |

## Security Features

- JWT authentication with configurable expiry
- Bcrypt password hashing (12 rounds)
- Helmet.js HTTP security headers
- CORS with configurable origins
- Rate limiting (100 req/15min globally, 10 auth attempts)
- Non-root Docker containers
- Environment-based secret management
- Input validation on all endpoints

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) automates:

1. **Test** — Unit tests for all services (parallel matrix)
2. **Lint** — ESLint code quality checks
3. **Security** — `npm audit` for vulnerabilities
4. **Build** — Docker images pushed to GHCR
5. **Deploy** — SSH deployment to production server

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Production server IP/hostname |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_SSH_KEY` | SSH private key |
| `SLACK_WEBHOOK` | Slack deployment notifications |

## Project Structure

```
ecommerce/
├── gateway/              # API Gateway
├── services/
│   ├── user/            # User auth & profiles
│   ├── product/         # Product catalog
│   ├── cart/            # Shopping cart (Redis)
│   ├── order/           # Order management
│   ├── payment/         # Stripe payments
│   └── notification/    # Email notifications
├── docker/
│   ├── mongo-init.js    # DB initialization & seed data
│   ├── prometheus.yml   # Metrics config
│   ├── logstash.conf    # Log pipeline
│   └── grafana/         # Dashboard configs
├── k8s/
│   └── deployment.yml   # Kubernetes manifests + HPA
├── scripts/
│   └── manage.sh        # Platform management CLI
├── .github/
│   └── workflows/
│       └── ci-cd.yml    # GitHub Actions pipeline
├── docker-compose.yml       # Production orchestration
├── docker-compose.dev.yml   # Development overrides
└── .env.example             # Environment template
```

