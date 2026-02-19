#!/bin/bash
set -e

# ─── E-Commerce Platform Management Script ─────────────────────────────────────
COMPOSE="docker compose"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo -e "\n${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}  E-Commerce Microservices Platform${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}\n"
}

check_requirements() {
  echo -e "${YELLOW}Checking requirements...${NC}"
  for cmd in docker docker-compose node npm; do
    if ! command -v $cmd &> /dev/null; then
      echo -e "${RED}✗ $cmd not found. Please install it.${NC}"
      exit 1
    fi
    echo -e "${GREEN}✓ $cmd$(NC)"
  done
}

setup_env() {
  if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env created. Please update with your actual values.${NC}"
  fi
}

start_dev() {
  echo -e "${GREEN}Starting in DEVELOPMENT mode...${NC}"
  setup_env
  $COMPOSE -f docker-compose.yml -f docker-compose.dev.yml up -d
  print_endpoints
}

start_prod() {
  echo -e "${GREEN}Starting in PRODUCTION mode...${NC}"
  setup_env
  $COMPOSE up -d
  print_endpoints
}

stop() {
  echo -e "${YELLOW}Stopping all services...${NC}"
  $COMPOSE down
  echo -e "${GREEN}All services stopped.${NC}"
}

restart_service() {
  local svc=$1
  echo -e "${YELLOW}Restarting $svc...${NC}"
  $COMPOSE restart $svc
  echo -e "${GREEN}$svc restarted.${NC}"
}

logs() {
  local svc=${1:-""}
  if [ -z "$svc" ]; then
    $COMPOSE logs -f --tail=100
  else
    $COMPOSE logs -f --tail=100 $svc
  fi
}

status() {
  echo -e "${BLUE}Service Status:${NC}"
  $COMPOSE ps
}

health_check() {
  echo -e "${BLUE}Checking service health...${NC}"
  services=("3000:api-gateway" "3001:user-service" "3002:product-service"
            "3003:cart-service" "3004:order-service" "3005:payment-service"
            "3006:notification-service")

  for entry in "${services[@]}"; do
    port="${entry%%:*}"
    name="${entry##*:}"
    if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ $name (port $port) - healthy${NC}"
    else
      echo -e "${RED}✗ $name (port $port) - unreachable${NC}"
    fi
  done
}

print_endpoints() {
  echo -e "\n${GREEN}🚀 Platform is running!${NC}\n"
  echo -e "${BLUE}Service Endpoints:${NC}"
  echo -e "  API Gateway:       http://localhost:3000"
  echo -e "  RabbitMQ UI:       http://localhost:15672  (admin/rabbitpass)"
  echo -e "  Grafana:           http://localhost:3100   (admin/grafanapass)"
  echo -e "  Prometheus:        http://localhost:9090"
  echo -e "  Kibana:            http://localhost:5601"
  echo -e "  Elasticsearch:     http://localhost:9200"
  echo ""
  echo -e "${BLUE}Dev Tools (dev mode only):${NC}"
  echo -e "  Mongo Express:     http://localhost:8081"
  echo -e "  Redis Commander:   http://localhost:8082"
  echo ""
  echo -e "${BLUE}API Reference:${NC}"
  echo -e "  POST /api/auth/register   - Create account"
  echo -e "  POST /api/auth/login      - Get JWT token"
  echo -e "  GET  /api/products        - Browse products"
  echo -e "  POST /api/cart/items      - Add to cart"
  echo -e "  POST /api/orders          - Place order"
  echo -e "  POST /api/payments/intent - Create payment"
  echo ""
}

build() {
  echo -e "${YELLOW}Building all services...${NC}"
  $COMPOSE build --parallel
  echo -e "${GREEN}Build complete.${NC}"
}

clean() {
  echo -e "${RED}WARNING: This will remove all containers, volumes, and images!${NC}"
  read -p "Are you sure? (yes/no): " confirm
  if [ "$confirm" = "yes" ]; then
    $COMPOSE down -v --rmi local
    echo -e "${GREEN}Cleanup complete.${NC}"
  fi
}

seed() {
  echo -e "${YELLOW}Seeding database...${NC}"
  # MongoDB seed runs automatically via docker/mongo-init.js
  echo -e "${GREEN}Database seeded (see docker/mongo-init.js for seed data)${NC}"
}

# ─── Command Router ────────────────────────────────────────────────────────────
print_header

case "${1:-help}" in
  start:dev)   start_dev ;;
  start:prod)  start_prod ;;
  stop)        stop ;;
  restart)     restart_service "$2" ;;
  logs)        logs "$2" ;;
  status)      status ;;
  health)      health_check ;;
  build)       build ;;
  clean)       clean ;;
  seed)        seed ;;
  *)
    echo "Usage: ./scripts/manage.sh [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start:dev    Start in development mode (hot reload + dev tools)"
    echo "  start:prod   Start in production mode"
    echo "  stop         Stop all services"
    echo "  restart <svc> Restart a specific service"
    echo "  logs [svc]   View logs (optionally for specific service)"
    echo "  status       Show container status"
    echo "  health       Check all service health endpoints"
    echo "  build        Build all Docker images"
    echo "  clean        Remove all containers and volumes (destructive!)"
    echo "  seed         Seed the database with sample data"
    ;;
esac
