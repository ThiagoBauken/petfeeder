#!/bin/bash

# ==========================================
# PetFeeder SaaS - Deploy Script
# ==========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DOMAIN=${1:-petfeeder.com.br}
ENV=${2:-production}

echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   PetFeeder SaaS Deploy Script       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# ==================== FUNCTIONS ====================

check_requirements() {
    echo -e "${YELLOW}Verificando requisitos...${NC}"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker não encontrado${NC}"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}❌ Docker Compose não encontrado${NC}"
        exit 1
    fi
    
    # Check Git
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git não encontrado${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Todos os requisitos instalados${NC}"
}

setup_environment() {
    echo -e "${YELLOW}Configurando ambiente...${NC}"
    
    # Create .env if not exists
    if [ ! -f .env ]; then
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Arquivo .env criado. Por favor, configure as variáveis!${NC}"
        echo -e "${YELLOW}   Edite o arquivo .env e execute o script novamente.${NC}"
        exit 0
    fi
    
    # Load environment variables
    export $(cat .env | grep -v '^#' | xargs)
    
    echo -e "${GREEN}✅ Variáveis de ambiente carregadas${NC}"
}

create_directories() {
    echo -e "${YELLOW}Criando diretórios...${NC}"
    
    mkdir -p mosquitto/config
    mkdir -p mosquitto/data
    mkdir -p mosquitto/log
    mkdir -p backups
    mkdir -p uploads
    mkdir -p logs
    mkdir -p letsencrypt
    mkdir -p grafana/dashboards
    mkdir -p grafana/datasources
    mkdir -p prometheus
    
    # Set permissions
    chmod 755 mosquitto/config
    chmod 755 mosquitto/data
    chmod 755 mosquitto/log
    
    echo -e "${GREEN}✅ Diretórios criados${NC}"
}

setup_mosquitto() {
    echo -e "${YELLOW}Configurando Mosquitto...${NC}"
    
    # Create password file
    if [ ! -f mosquitto/config/passwords.txt ]; then
        touch mosquitto/config/passwords.txt
        
        # Add admin user
        docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto \
            mosquitto_passwd -b /mosquitto/config/passwords.txt admin ${MQTT_PASSWORD:-admin123}
        
        # Add server user
        docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto \
            mosquitto_passwd -b /mosquitto/config/passwords.txt server ${MQTT_PASSWORD:-server123}
        
        echo -e "${GREEN}✅ Usuários MQTT criados${NC}"
    fi
}

generate_ssl_certificates() {
    echo -e "${YELLOW}Gerando certificados SSL (desenvolvimento)...${NC}"
    
    if [ "$ENV" = "development" ] && [ ! -f certificates/server.crt ]; then
        mkdir -p certificates
        
        # Generate self-signed certificate for development
        openssl req -x509 -newkey rsa:4096 -nodes \
            -keyout certificates/server.key \
            -out certificates/server.crt \
            -days 365 \
            -subj "/C=BR/ST=SP/L=Sao Paulo/O=PetFeeder/CN=localhost"
        
        echo -e "${GREEN}✅ Certificados SSL gerados (desenvolvimento)${NC}"
    fi
}

build_images() {
    echo -e "${YELLOW}Construindo imagens Docker...${NC}"
    
    # Build backend
    docker-compose build backend --no-cache
    
    # Build frontend (if exists)
    if [ -d "frontend" ]; then
        docker-compose build frontend --no-cache
    fi
    
    echo -e "${GREEN}✅ Imagens construídas${NC}"
}

initialize_database() {
    echo -e "${YELLOW}Inicializando banco de dados...${NC}"
    
    # Start only PostgreSQL
    docker-compose up -d postgres
    
    # Wait for PostgreSQL to be ready
    echo "Aguardando PostgreSQL inicializar..."
    sleep 10
    
    # Run migrations (if using Prisma)
    if [ -f "prisma/schema.prisma" ]; then
        docker-compose run --rm backend npx prisma migrate deploy
        docker-compose run --rm backend npx prisma db seed
    fi
    
    echo -e "${GREEN}✅ Banco de dados inicializado${NC}"
}

start_services() {
    echo -e "${YELLOW}Iniciando serviços...${NC}"
    
    # Start all services
    docker-compose up -d
    
    # Wait for services to be healthy
    echo "Aguardando serviços ficarem saudáveis..."
    sleep 15
    
    # Check services status
    docker-compose ps
    
    echo -e "${GREEN}✅ Todos os serviços iniciados${NC}"
}

setup_monitoring() {
    echo -e "${YELLOW}Configurando monitoramento...${NC}"
    
    # Create Grafana datasource configuration
    cat > grafana/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    
  - name: PostgreSQL
    type: postgres
    access: proxy
    url: postgres:5432
    database: petfeeder
    user: \${DB_USER}
    secureJsonData:
      password: \${DB_PASSWORD}
      
  - name: Redis
    type: redis-datasource
    access: proxy
    url: redis://redis:6379
    secureJsonData:
      password: \${REDIS_PASSWORD}
EOF
    
    # Create Prometheus configuration
    cat > prometheus/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'backend'
    static_configs:
      - targets: ['backend:3000']
        
  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']
        
  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']
EOF
    
    echo -e "${GREEN}✅ Monitoramento configurado${NC}"
}

setup_backup() {
    echo -e "${YELLOW}Configurando backup automático...${NC}"
    
    # Create backup script
    cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# Backup PostgreSQL
docker-compose exec -T postgres pg_dump -U petfeeder petfeeder > $BACKUP_DIR/database.sql

# Backup uploads
tar czf $BACKUP_DIR/uploads.tar.gz uploads/

# Backup configurations
tar czf $BACKUP_DIR/configs.tar.gz mosquitto/config/ .env

# Keep only last 30 days of backups
find backups/ -type d -mtime +30 -exec rm -rf {} +

echo "Backup completed: $BACKUP_DIR"
EOF
    
    chmod +x backup.sh
    
    # Add to crontab (daily at 2 AM)
    (crontab -l 2>/dev/null; echo "0 2 * * * $(pwd)/backup.sh") | crontab -
    
    echo -e "${GREEN}✅ Backup automático configurado${NC}"
}

health_check() {
    echo -e "${YELLOW}Verificando saúde dos serviços...${NC}"
    
    # Check backend health
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Backend: OK${NC}"
    else
        echo -e "${RED}❌ Backend: FALHOU${NC}"
    fi
    
    # Check PostgreSQL
    if docker-compose exec postgres pg_isready > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL: OK${NC}"
    else
        echo -e "${RED}❌ PostgreSQL: FALHOU${NC}"
    fi
    
    # Check Redis
    if docker-compose exec redis redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Redis: OK${NC}"
    else
        echo -e "${RED}❌ Redis: FALHOU${NC}"
    fi
    
    # Check MQTT
    if nc -zv localhost 1883 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ MQTT: OK${NC}"
    else
        echo -e "${RED}❌ MQTT: FALHOU${NC}"
    fi
}

print_info() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     Deploy Concluído com Sucesso!    ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}URLs de Acesso:${NC}"
    echo -e "  Backend API:    http://${DOMAIN}:3000"
    echo -e "  Frontend:       http://${DOMAIN}:3001"
    echo -e "  Grafana:        http://${DOMAIN}:3002"
    echo -e "  Traefik Admin:  http://${DOMAIN}:8081"
    echo ""
    echo -e "${YELLOW}Credenciais Padrão:${NC}"
    echo -e "  Grafana:  admin / ${GRAFANA_PASSWORD:-admin}"
    echo -e "  MQTT:     admin / ${MQTT_PASSWORD:-admin123}"
    echo ""
    echo -e "${YELLOW}Comandos Úteis:${NC}"
    echo -e "  Ver logs:         docker-compose logs -f [service]"
    echo -e "  Parar serviços:   docker-compose down"
    echo -e "  Reiniciar:        docker-compose restart [service]"
    echo -e "  Backup manual:    ./backup.sh"
    echo ""
    echo -e "${YELLOW}Próximos Passos:${NC}"
    echo -e "  1. Configure o DNS apontando para este servidor"
    echo -e "  2. Ative HTTPS no Traefik (port 443)"
    echo -e "  3. Configure as variáveis de produção no .env"
    echo -e "  4. Configure o firewall (ufw/iptables)"
    echo -e "  5. Configure o monitoramento externo"
    echo ""
}

cleanup_on_error() {
    echo -e "${RED}❌ Erro durante o deploy. Limpando...${NC}"
    docker-compose down
    exit 1
}

# ==================== MAIN ====================

# Trap errors
trap cleanup_on_error ERR

# Run deployment steps
check_requirements
setup_environment
create_directories
setup_mosquitto
generate_ssl_certificates
build_images
initialize_database
start_services
setup_monitoring
setup_backup
health_check
print_info

echo -e "${GREEN}🚀 Deploy completo!${NC}"
