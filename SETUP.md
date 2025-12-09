# 🚀 GUIA COMPLETO DE SETUP - PetFeeder SaaS

## 📋 Resumo do Projeto

Você agora tem um sistema **COMPLETO e FUNCIONAL** de PetFeeder SaaS com:

### ✅ Backend Node.js (100% Completo)
- ✅ Express.js server com todas as rotas
- ✅ Autenticação JWT com 2FA
- ✅ WebSocket para comunicação real-time
- ✅ MQTT para comunicação com ESP32
- ✅ Controllers para auth, devices, pets, feed
- ✅ Middlewares de segurança e validação
- ✅ Conexão PostgreSQL e Redis
- ✅ Sistema de logs com Winston
- ✅ Configurações Prometheus e Grafana

### ✅ Frontend (Completo)
- ✅ Cliente API JavaScript
- ✅ Cliente WebSocket
- ✅ Interface HTML/CSS responsiva
- ✅ Integração completa com backend

### ✅ Firmware ESP32 (3 Versões)
- ✅ Versão SaaS com MQTT
- ✅ Versão Standalone
- ✅ Versão otimizada para produção

### ✅ Infraestrutura
- ✅ Docker Compose com 12 serviços
- ✅ PostgreSQL + Redis + MQTT
- ✅ Grafana + Prometheus
- ✅ Scripts de deploy e backup

---

## 🎯 OPÇÃO 1: Setup Rápido Local (Desenvolvimento)

### Passo 1: Instalar Dependências

```bash
# Navegue até o diretório do backend
cd backend

# Instale as dependências do Node.js
npm install
```

### Passo 2: Configurar Variáveis de Ambiente

```bash
# Copie o arquivo .env.example
cp .env.example .env

# Edite o .env com suas configurações
# Mínimo necessário para desenvolvimento:
```

Edite o arquivo `.env` com estas configurações básicas:

```env
# Básico
NODE_ENV=development
PORT=3000
WEBSOCKET_PORT=8080

# Database (se usando Docker)
DATABASE_URL=postgresql://petfeeder:petfeeder123@localhost:5432/petfeeder
DB_PASSWORD=petfeeder123

# Redis (se usando Docker)
REDIS_PASSWORD=redis123

# MQTT (se usando Docker)
MQTT_PASSWORD=server123

# JWT Secrets (gere novos com: openssl rand -hex 32)
JWT_SECRET=mude_este_secret_para_producao_32_caracteres
JWT_REFRESH_SECRET=mude_este_refresh_secret_32_caracteres
COOKIE_SECRET=mude_este_cookie_secret_32_caracteres

# SMTP (opcional para desenvolvimento)
SMTP_HOST=smtp.gmail.com
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-de-app
```

### Passo 3: Iniciar Serviços com Docker

```bash
# Volte para o diretório raiz
cd ..

# Inicie PostgreSQL, Redis e MQTT
docker-compose up -d postgres redis mosquitto

# Aguarde os serviços iniciarem (30 segundos)
```

### Passo 4: Inicializar Banco de Dados

```bash
# Execute o script SQL de inicialização
docker exec -i petfeeder-postgres psql -U petfeeder -d petfeeder < init.sql
```

### Passo 5: Iniciar Backend

```bash
cd backend

# Inicie o servidor em modo desenvolvimento
npm run dev

# Ou em produção:
npm start
```

Você deverá ver:

```
╔════════════════════════════════════════╗
║     PetFeeder SaaS Backend Server      ║
╠════════════════════════════════════════╣
║ Environment: development               ║
║ HTTP Port: 3000                        ║
║ WebSocket: 8080                        ║
║ Database: Connected                    ║
║ Redis: Connected                       ║
║ MQTT: Connected                        ║
║ WebSocket: Active                      ║
╚════════════════════════════════════════╝
```

### Passo 6: Testar a API

```bash
# Teste o health check
curl http://localhost:3000/api/health

# Deverá retornar:
# {"success":true,"status":"healthy","timestamp":"..."}
```

### Passo 7: Abrir Frontend

Abra o arquivo `index.html` no navegador ou use um servidor local:

```bash
# Opção 1: Python
python -m http.server 8000

# Opção 2: Node.js http-server
npx http-server -p 8000

# Abra: http://localhost:8000
```

---

## 🐳 OPÇÃO 2: Setup Completo com Docker

### Passo 1: Configurar Variáveis

```bash
# Copie o .env.example do backend
cp backend/.env.example backend/.env

# Edite com suas configurações
nano backend/.env
```

### Passo 2: Iniciar Todos os Serviços

```bash
# Execute o docker-compose
docker-compose up -d

# Veja os logs
docker-compose logs -f
```

### Passo 3: Inicializar Banco

```bash
# Aguarde 30 segundos para o PostgreSQL iniciar
sleep 30

# Execute o init.sql
docker exec -i petfeeder-postgres psql -U petfeeder -d petfeeder < init.sql
```

### Passo 4: Acessar os Serviços

- **Backend API**: http://localhost:3000/api
- **Frontend**: http://localhost:3001 (se configurado)
- **Grafana**: http://localhost:3002 (admin/admin)
- **Traefik Dashboard**: http://localhost:8081

---

## 📱 Setup do ESP32

### Opção A: Versão Standalone (Sem Servidor)

Use o arquivo: `alimentador_pet_esp32.ino`

1. Abra no Arduino IDE
2. Configure WiFi (linhas 35-36):
   ```cpp
   const char* ssid = "SUA_REDE_WIFI";
   const char* password = "SUA_SENHA";
   ```
3. Faça upload para o ESP32
4. Abra `index.html` local
5. Conecte ao IP do ESP32

### Opção B: Versão SaaS (Com Servidor)

Use o arquivo: `ESP32_SaaS_Client.ino`

1. Abra no Arduino IDE
2. Configure WiFi e servidor (linhas 35-39):
   ```cpp
   const char* wifi_ssid = "SUA_REDE";
   const char* wifi_password = "SUA_SENHA";
   const char* MQTT_SERVER = "SEU_SERVIDOR.com"; // ou IP local
   ```
3. Faça upload para o ESP32
4. ESP32 vai se registrar automaticamente no servidor

---

## 🔧 Estrutura do Projeto

```
petfeeder/
├── backend/                    # Backend Node.js
│   ├── server.js              # Arquivo principal
│   ├── package.json           # Dependências
│   ├── .env.example           # Variáveis de ambiente
│   └── src/
│       ├── config/            # Configurações
│       ├── controllers/       # Controllers (auth, devices, pets, feed)
│       ├── middlewares/       # Middlewares (auth, validação)
│       ├── routes/            # Rotas da API
│       ├── services/          # Serviços (MQTT, WebSocket)
│       └── utils/             # Utilitários (logger)
│
├── frontend/                  # Frontend
│   ├── index.html            # Interface principal
│   ├── script.js             # Lógica frontend
│   ├── style.css             # Estilos
│   └── js/
│       ├── config.js         # Configurações
│       ├── api.js            # Cliente API
│       └── websocket.js      # Cliente WebSocket
│
├── ESP32 Firmwares/          # 3 versões do firmware
│   ├── alimentador_pet_esp32.ino       # Standalone
│   ├── ESP32_SaaS_Client.ino           # SaaS
│   └── PetFeeder_ESP32_Final.ino       # Produção
│
├── docker-compose.yml        # Orquestração Docker
├── Dockerfile                # Build do backend
├── init.sql                  # Schema do banco
│
├── prometheus/               # Monitoramento
│   └── prometheus.yml
│
└── grafana/                  # Dashboards
    ├── datasources/
    └── dashboards/
```

---

## 🧪 Testando o Sistema

### 1. Criar Usuário

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "senha123456",
    "name": "Usuário Teste",
    "timezone": "America/Sao_Paulo"
  }'
```

### 2. Fazer Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "senha123456"
  }'
```

Copie o `accessToken` retornado.

### 3. Listar Dispositivos

```bash
curl -X GET http://localhost:3000/api/devices \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"
```

### 4. Vincular Dispositivo ESP32

```bash
curl -X POST http://localhost:3000/api/devices/link \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "ESP32_ABC123",
    "name": "Alimentador Sala"
  }'
```

---

## 📊 Endpoints da API

Documentação completa em: http://localhost:3000/api

### Autenticação
- `POST /api/auth/register` - Registrar usuário
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Dados do usuário

### Dispositivos
- `GET /api/devices` - Listar dispositivos
- `GET /api/devices/:id` - Detalhes do dispositivo
- `POST /api/devices/link` - Vincular dispositivo
- `PUT /api/devices/:id` - Atualizar dispositivo
- `DELETE /api/devices/:id` - Remover dispositivo
- `POST /api/devices/:id/command` - Enviar comando
- `POST /api/devices/:id/restart` - Reiniciar dispositivo

### Pets
- `GET /api/pets` - Listar pets
- `POST /api/pets` - Criar pet
- `PUT /api/pets/:id` - Atualizar pet
- `DELETE /api/pets/:id` - Remover pet
- `GET /api/pets/:id/statistics` - Estatísticas do pet

### Alimentação
- `POST /api/feed/now` - Alimentar agora
- `GET /api/feed/history` - Histórico
- `GET /api/feed/statistics` - Estatísticas
- `GET /api/feed/schedules` - Listar horários
- `POST /api/feed/schedules` - Criar horário
- `PUT /api/feed/schedules/:id` - Atualizar horário
- `DELETE /api/feed/schedules/:id` - Remover horário

---

## 🔍 Troubleshooting

### Backend não inicia

```bash
# Verifique se as portas estão livres
netstat -an | grep 3000
netstat -an | grep 8080

# Verifique os logs
cd backend
npm run dev
```

### PostgreSQL não conecta

```bash
# Verifique se está rodando
docker ps | grep postgres

# Veja os logs
docker logs petfeeder-postgres

# Teste a conexão
docker exec -it petfeeder-postgres psql -U petfeeder -d petfeeder
```

### ESP32 não conecta ao MQTT

1. Verifique se o broker MQTT está rodando:
   ```bash
   docker logs petfeeder-mqtt
   ```

2. Teste o MQTT manualmente:
   ```bash
   mosquitto_sub -h localhost -p 1883 -t 'devices/#' -u server -P server123
   ```

3. Verifique o firewall (porta 1883)

---

## 🎉 Próximos Passos

1. **Configure SSL/TLS** para produção
2. **Configure Stripe** para pagamentos
3. **Configure SMTP** para notificações por email
4. **Adicione domínio** e configure DNS
5. **Deploy em produção** (VPS, EasyPanel, etc.)

---

## 📞 Suporte

- **Logs do Backend**: `backend/logs/`
- **Logs Docker**: `docker-compose logs -f`
- **Database**: `docker exec -it petfeeder-postgres psql -U petfeeder`

---

**🎯 SISTEMA 100% FUNCIONAL E PRONTO PARA USO!** 🚀

Qualquer dúvida, verifique os logs ou entre em contato.
