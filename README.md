# 🐾 PetFeeder SaaS - Sistema Multi-Tenant de Alimentadores Automáticos

Sistema completo para gerenciamento de alimentadores automáticos de pets, com suporte multi-usuário, planos de assinatura e controle via IoT.

## 🚀 Características Principais

- **Multi-Tenant**: Suporte para múltiplos usuários e dispositivos
- **Planos de Assinatura**: Free, Basic, Premium com Stripe
- **Controle IoT**: Comunicação em tempo real via MQTT
- **Interface Responsiva**: Dashboard web e mobile
- **Monitoramento**: Grafana + Prometheus integrados
- **Segurança**: JWT, 2FA, SSL/TLS
- **Escalável**: Docker + Kubernetes ready

## 📋 Requisitos

- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+ (desenvolvimento)
- PostgreSQL 15+ 
- Redis 7+
- 2GB RAM mínimo
- 10GB espaço em disco

## 🏗️ Arquitetura

```
┌─────────────┐     MQTT/WSS      ┌──────────────┐      API REST     ┌─────────────┐
│   ESP32     ├──────────────────►│              │◄──────────────────┤  Web App    │
│  Devices    │                    │   Backend    │                   │  (React)    │
└─────────────┘                    │   Node.js    │                   └─────────────┘
                                   │              │
                                   │  PostgreSQL  │                   ┌─────────────┐
                                   │    Redis     │◄──────────────────┤Mobile App   │
                                   │   Mosquitto  │                   │(React Native)│
                                   └──────────────┘                   └─────────────┘
```

## 🛠️ Instalação Rápida

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/petfeeder-saas.git
cd petfeeder-saas
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
nano .env
```

### 3. Execute o script de deploy

```bash
chmod +x deploy.sh
./deploy.sh petfeeder.com.br production
```

## 🐳 Deploy com Docker

### Desenvolvimento

```bash
# Iniciar todos os serviços
docker-compose up -d

# Ver logs
docker-compose logs -f backend

# Parar serviços
docker-compose down
```

### Produção

```bash
# Build e deploy
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Com Traefik para SSL automático
docker-compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

## 🌐 Deploy no EasyPanel

1. Crie uma nova aplicação no EasyPanel
2. Configure o GitHub como fonte
3. Use o arquivo `easypanel.yaml` incluído
4. Configure as variáveis de ambiente no painel
5. Deploy automático via push

## 📝 Configuração do ESP32

### Hardware Necessário

- ESP32-WROOM-32 DevKit
- Motor 28BYJ-48 + Driver ULN2003
- Sensor HC-SR04 (3x)
- RTC DS3231
- Fonte 5V 3A

### Upload do Firmware

```bash
# Instale PlatformIO
pip install platformio

# Configure WiFi e servidor no código
# Edite ESP32_SaaS_Client.ino linhas 35-39

# Upload para o ESP32
platformio run --target upload
```

### Registro do Dispositivo

1. ESP32 se conecta ao WiFi
2. Registra automaticamente no servidor
3. Aparece no dashboard do usuário
4. Usuário vincula ao sua conta

## 🔧 API Endpoints

### Autenticação
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

### Dispositivos
```
GET    /api/devices
POST   /api/devices/link
PUT    /api/devices/:id
DELETE /api/devices/:id
POST   /api/devices/:id/command
```

### Pets
```
GET    /api/pets
POST   /api/pets
PUT    /api/pets/:id
DELETE /api/pets/:id
```

### Alimentação
```
POST   /api/feed/manual
GET    /api/feed/history
GET    /api/feed/statistics
```

## 📊 Banco de Dados

### Estrutura Principal

- `users` - Usuários do sistema
- `devices` - Dispositivos ESP32
- `pets` - Informações dos pets
- `schedules` - Horários programados
- `feedings` - Histórico de alimentações
- `telemetry` - Dados de sensores
- `alerts` - Alertas e notificações

### Migrations

```bash
# Criar nova migration
npx prisma migrate dev --name nome_da_migration

# Aplicar migrations
npx prisma migrate deploy

# Reset database
npx prisma migrate reset
```

## 🔐 Segurança

### SSL/TLS

Produção usa Let's Encrypt automático via Traefik:

```yaml
# docker-compose.traefik.yml
labels:
  - "traefik.http.routers.backend.tls.certresolver=letsencrypt"
```

### Autenticação

- JWT com refresh tokens
- 2FA opcional via TOTP
- OAuth2 (Google, Facebook)

### MQTT Security

- Autenticação por usuário/senha
- ACL por dispositivo
- TLS obrigatório em produção

## 📈 Monitoramento

### Grafana

Acesse: `http://localhost:3002`

Dashboards incluídos:
- Device Overview
- User Analytics  
- System Metrics
- MQTT Statistics

### Prometheus

Métricas coletadas:
- CPU/Memory usage
- Request latency
- Database queries
- MQTT messages

### Logs

```bash
# Backend logs
docker logs petfeeder-backend -f

# Todos os logs
docker-compose logs -f

# Logs específicos
docker-compose logs postgres -f
```

## 🧪 Testes

```bash
# Testes unitários
npm test

# Testes de integração
npm run test:integration

# Testes E2E
npm run test:e2e

# Coverage
npm run test:coverage
```

## 📦 CI/CD

### GitHub Actions

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to server
        run: |
          ssh ${{ secrets.SERVER }} 'cd /app && git pull && docker-compose up -d --build'
```

## 🔄 Backup

### Automático

Configurado via cron para rodar diariamente:

```bash
# Ver backups
ls -la backups/

# Restaurar backup
./restore.sh backups/20240120_020000/
```

### Manual

```bash
# Backup completo
./backup.sh

# Apenas database
docker-compose exec postgres pg_dump -U petfeeder petfeeder > backup.sql

# Restaurar
docker-compose exec -T postgres psql -U petfeeder petfeeder < backup.sql
```

## 📱 Apps Mobile

### React Native

```bash
cd mobile
npm install
npx react-native run-android
npx react-native run-ios
```

### Flutter (alternativa)

```bash
cd mobile-flutter
flutter pub get
flutter run
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie sua feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.

## 👥 Time

- **Seu Nome** - *Desenvolvedor Principal* - [@seu-usuario](https://github.com/seu-usuario)

## 📞 Suporte

- Email: suporte@petfeeder.com.br
- Discord: [PetFeeder Community](https://discord.gg/petfeeder)
- Docs: [docs.petfeeder.com.br](https://docs.petfeeder.com.br)

## 🗺️ Roadmap

- [x] MVP com funcionalidades básicas
- [x] Sistema de pagamentos
- [x] App mobile
- [ ] Integração com Alexa/Google Home
- [ ] Machine Learning para previsão de consumo
- [ ] Câmera com reconhecimento de pets
- [ ] Versão para múltiplos tipos de animais

## 💰 Planos e Preços

| Plano | Dispositivos | Pets | Horários | Analytics | Preço |
|-------|-------------|------|----------|-----------|-------|
| Free | 1 | 3 | 3 | ❌ | R$ 0 |
| Basic | 3 | 9 | 10 | ❌ | R$ 9,90/mês |
| Premium | 10 | 30 | 50 | ✅ | R$ 29,90/mês |
| Enterprise | Ilimitado | Ilimitado | Ilimitado | ✅ | Consulte |

## 🚨 Troubleshooting

### Erro: "Cannot connect to Docker daemon"
```bash
sudo systemctl start docker
sudo usermod -aG docker $USER
```

### Erro: "Port already in use"
```bash
# Verificar portas em uso
sudo lsof -i :3000
# Matar processo
sudo kill -9 <PID>
```

### ESP32 não conecta
1. Verifique WiFi credentials
2. Confirme servidor MQTT rodando
3. Check firewall rules
4. Veja logs: `docker logs petfeeder-mqtt`

---

**Desenvolvido com ❤️ para pets e seus humanos**
