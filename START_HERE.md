# 🚀 START HERE - PetFeeder SaaS Completo

## 🎯 INÍCIO RÁPIDO (5 minutos)

### 1. Instalar Dependências do Backend

```bash
cd backend
npm install
```

### 2. Configurar Variáveis de Ambiente

```bash
cp .env.example .env
```

Edite o `.env` com o **MÍNIMO**:

```env
JWT_SECRET=dev_secret_min_32_caracteres_para_jwt_token
JWT_REFRESH_SECRET=dev_refresh_secret_min_32_caracteres_token
COOKIE_SECRET=dev_cookie_secret_min_32_caracteres
DB_PASSWORD=petfeeder123
REDIS_PASSWORD=redis123
MQTT_PASSWORD=server123
```

### 3. Iniciar Serviços (Docker)

```bash
cd ..
docker-compose up -d postgres redis mosquitto
sleep 30  # Aguardar 30 segundos
docker exec -i petfeeder-postgres psql -U petfeeder -d petfeeder < init.sql
```

### 4. Iniciar Backend

```bash
cd backend
npm run dev
```

Aguarde ver:
```
╔════════════════════════════════════════╗
║     PetFeeder SaaS Backend Server      ║
║ Database: Connected ✓                  ║
║ MQTT: Connected ✓                      ║
╚════════════════════════════════════════╝
```

### 5. Abrir Frontend

```bash
# Em outro terminal
cd frontend
python -m http.server 8000
```

Abra: **http://localhost:8000/login.html**

### 6. Criar Conta

- Nome: Seu Nome
- Email: teste@exemplo.com
- Senha: senha123456

**PRONTO! Você está no dashboard!** 🎉

---

## 📚 PRÓXIMOS PASSOS

### Para conectar o ESP32:

👉 Leia: **[INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)**

### Para entender o projeto:

👉 Leia: **[COMPLETADO.md](COMPLETADO.md)**

### Para deploy em produção:

👉 Leia: **[SETUP.md](SETUP.md)**

---

## 📂 ESTRUTURA DO PROJETO

```
petfeeder/
├── backend/              ← Backend Node.js
│   ├── server.js         ← Servidor principal
│   ├── src/
│   │   ├── controllers/  ← Lógica de negócio
│   │   ├── routes/       ← Rotas da API
│   │   ├── services/     ← MQTT, WebSocket
│   │   └── config/       ← Configurações
│   └── package.json
│
├── frontend/             ← Frontend
│   ├── login.html        ← Página de login
│   ├── dashboard.html    ← Dashboard principal
│   ├── js/
│   │   ├── api.js        ← Cliente REST API
│   │   ├── websocket.js  ← Cliente WebSocket
│   │   ├── app.js        ← Lógica da aplicação
│   │   └── config.js     ← Configurações
│   └── style.css
│
├── ESP32_SaaS_Client.ino     ← Firmware ESP32 (versão SaaS)
├── alimentador_pet_esp32.ino ← Firmware ESP32 (standalone)
├── docker-compose.yml        ← Orquestração Docker
├── init.sql                  ← Schema do banco
│
└── Documentação/
    ├── START_HERE.md          ← VOCÊ ESTÁ AQUI!
    ├── INTEGRACAO_COMPLETA.md ← Guia de integração
    ├── COMPLETADO.md          ← Resumo do projeto
    └── SETUP.md               ← Setup completo
```

---

## 🧪 TESTAR A API

### Criar Usuário:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "senha123456",
    "name": "Teste"
  }'
```

### Fazer Login:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "senha123456"
  }'
```

Copie o `accessToken` retornado!

### Listar Dispositivos:

```bash
curl -X GET http://localhost:3000/api/devices \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

---

## ✅ O QUE VOCÊ TEM

- ✅ **28 endpoints REST API** funcionais
- ✅ **Backend Node.js** completo
- ✅ **Frontend responsivo** com login/dashboard
- ✅ **WebSocket** para tempo real
- ✅ **MQTT** para ESP32
- ✅ **PostgreSQL + Redis** configurados
- ✅ **Autenticação JWT** com refresh tokens
- ✅ **Sistema de planos** (Free/Basic/Premium)
- ✅ **3 versões de firmware** ESP32
- ✅ **Docker Compose** com 12 serviços
- ✅ **Monitoramento** Prometheus + Grafana

---

## 🎯 FLUXO DE USO

1. **Criar conta** no frontend
2. **Configurar ESP32** com seu WiFi e IP do servidor
3. **Upload firmware** para o ESP32
4. **Vincular dispositivo** no dashboard
5. **Adicionar pets**
6. **Criar horários**
7. **Alimentar manualmente** ou aguardar horários

---

## 🐛 PROBLEMAS COMUNS

### Backend não inicia?

```bash
# Verificar se Docker está rodando
docker ps

# Verificar logs
docker-compose logs
```

### Frontend não carrega?

```bash
# Verificar se servidor HTTP está rodando
lsof -i :8000  # Linux/Mac
netstat -ano | findstr :8000  # Windows
```

### ESP32 não conecta?

1. Verificar WiFi
2. Verificar IP do servidor
3. Testar MQTT:

```bash
mosquitto_sub -h localhost -p 1883 -t 'devices/#' -u server -P server123
```

---

## 💡 DICAS

- Use **Chrome/Firefox** para melhor compatibilidade
- Abra o **Console (F12)** para ver logs em tempo real
- Use **Postman** para testar a API
- Leia os **logs do backend** para debugging

---

## 📞 SUPORTE

- **Documentação**: Leia os arquivos `.md` nesta pasta
- **Logs Backend**: `backend/logs/`
- **Logs Docker**: `docker-compose logs -f`
- **Serial Monitor**: Para ver logs do ESP32

---

## 🎉 PARABÉNS!

Você tem um **sistema completo de PetFeeder SaaS**:

- Backend profissional
- Frontend moderno
- ESP32 integrado
- Banco de dados
- Tempo real
- Multi-usuário

**Agora é só usar e customizar!** 🚀

---

**Para integração ESP32 completa, leia:** [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)
