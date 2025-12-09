# 🔌 GUIA DE INTEGRAÇÃO COMPLETA - ESP32 + Backend + Frontend

## 📋 VISÃO GERAL

Este guia mostra como conectar **DE VERDADE** o ESP32 com o backend e frontend, sem dados mockados!

---

## 🎯 FLUXO COMPLETO

```
ESP32 → MQTT → Backend → WebSocket → Frontend
  ↓                ↓           ↓
Sensores      PostgreSQL    Dashboard
  ↓                ↓           ↓
Motores        Redis      Tempo Real
```

---

## 📝 PASSO 1: INICIAR O BACKEND

### 1.1 Configurar Ambiente

```bash
cd backend

# Criar .env
cp .env.example .env
```

Edite o `.env` com configurações **MÍNIMAS**:

```env
# === CONFIGURAÇÃO MÍNIMA PARA TESTE LOCAL ===

# Backend
NODE_ENV=development
PORT=3000
WEBSOCKET_PORT=8080

# Database (com Docker)
DATABASE_URL=postgresql://petfeeder:petfeeder123@localhost:5432/petfeeder
DB_PASSWORD=petfeeder123

# Redis (com Docker)
REDIS_PASSWORD=redis123

# MQTT (com Docker)
MQTT_USERNAME=server
MQTT_PASSWORD=server123

# Segurança (MUDE EM PRODUÇÃO!)
JWT_SECRET=dev_secret_min_32_caracteres_para_jwt_token
JWT_REFRESH_SECRET=dev_refresh_secret_min_32_caracteres_token
COOKIE_SECRET=dev_cookie_secret_min_32_caracteres
```

### 1.2 Instalar Dependências

```bash
npm install
```

### 1.3 Iniciar Serviços Docker

```bash
# Voltar para raiz
cd ..

# Iniciar PostgreSQL, Redis e MQTT
docker-compose up -d postgres redis mosquitto
```

**Aguarde 30 segundos** para os serviços iniciarem!

### 1.4 Criar Banco de Dados

```bash
# Executar init.sql
docker exec -i petfeeder-postgres psql -U petfeeder -d petfeeder < init.sql
```

### 1.5 Iniciar Backend

```bash
cd backend
npm run dev
```

**Você deve ver:**

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

✅ **Backend está rodando!**

---

## 🌐 PASSO 2: ABRIR O FRONTEND

### 2.1 Iniciar Servidor HTTP

```bash
# Em outro terminal, na raiz do projeto
cd frontend

# Opção 1: Python
python -m http.server 8000

# Opção 2: Node.js
npx http-server -p 8000
```

### 2.2 Abrir no Navegador

Abra: http://localhost:8000/login.html

---

## 👤 PASSO 3: CRIAR CONTA E FAZER LOGIN

### 3.1 Registrar Usuário

1. Clique na aba **"Registrar"**
2. Preencha:
   - Nome: Seu Nome
   - Email: teste@exemplo.com
   - Senha: senha123456
3. Clique em **"Criar Conta"**

✅ Você será redirecionado para o dashboard!

### 3.2 Testar Login

Se precisar fazer login novamente:

1. Email: teste@exemplo.com
2. Senha: senha123456

---

## 📱 PASSO 4: CONFIGURAR O ESP32

### 4.1 Escolher a Versão do Firmware

**Opção A: SaaS (Recomendado para este guia)**

Abra: `ESP32_SaaS_Client.ino`

**Opção B: Standalone**

Abra: `alimentador_pet_esp32.ino`

### 4.2 Configurar WiFi e Servidor

No Arduino IDE, edite as linhas:

```cpp
// WiFi
const char* wifi_ssid = "SUA_REDE_WIFI";
const char* wifi_password = "SUA_SENHA_WIFI";

// MQTT Server
const char* MQTT_SERVER = "SEU_IP_LOCAL";  // Ex: "192.168.1.100"
const int MQTT_PORT = 1883;
const char* MQTT_USER = "server";
const char* MQTT_PASS = "server123";
```

### 4.3 Descobrir Seu IP Local

**Windows:**
```bash
ipconfig
# Procure por "Endereço IPv4"
```

**Linux/Mac:**
```bash
ifconfig
# ou
ip addr show
```

Exemplo: `192.168.1.100`

Use esse IP no `MQTT_SERVER`!

### 4.4 Upload para o ESP32

1. Conecte o ESP32 via USB
2. Selecione a porta correta
3. Faça upload do código
4. Abra o Serial Monitor (115200 baud)

**Você deve ver:**

```
[INFO] WiFi conectado!
[INFO] IP: 192.168.1.150
[INFO] Conectando ao MQTT...
[INFO] MQTT conectado!
[INFO] Device ID: ESP32_A1B2C3
[INFO] Registrando no servidor...
[INFO] Registro concluído!
```

✅ **ESP32 está conectado ao backend!**

---

## 🔗 PASSO 5: VINCULAR O ESP32 NO FRONTEND

### 5.1 Copiar o Device ID

Do Serial Monitor, copie o **Device ID**:

```
[INFO] Device ID: ESP32_A1B2C3
         ↑
    Copie isto!
```

### 5.2 Vincular no Dashboard

1. No dashboard, clique na aba **"Dispositivos"**
2. Clique em **"Vincular Dispositivo"**
3. Cole o Device ID: `ESP32_A1B2C3`
4. Nome: `Alimentador Teste`
5. Clique em **"Vincular"**

✅ **Dispositivo aparecerá na lista com status "Online"!**

---

## 🐾 PASSO 6: ADICIONAR UM PET

### 6.1 Criar Pet

1. Vá para a aba **"Meus Pets"**
2. Clique em **"Adicionar Pet"**
3. Preencha:
   - Dispositivo: Alimentador Teste
   - Nome: Felix
   - Tipo: Gato
   - Compartimento: 1
   - Quantidade Diária: 100g
4. Clique em **"Adicionar"**

✅ **Pet criado!**

---

## 🍖 PASSO 7: TESTAR ALIMENTAÇÃO MANUAL

### 7.1 Alimentar pelo Dashboard

1. Na aba **"Dashboard"**, no card do pet
2. Clique em **"Alimentar"**

**O QUE ACONTECE:**

1. Frontend → API REST → Backend
2. Backend → MQTT → ESP32
3. ESP32 → Motor gira
4. ESP32 → MQTT → Backend
5. Backend → WebSocket → Frontend
6. Frontend atualiza em tempo real!

### 7.2 Verificar no Serial Monitor

```
[MQTT] Comando recebido: feed
[MQTT] Pet: 1, Quantidade: 100g
[MOTOR] Girando motor 1...
[MOTOR] Dispensado: 100g
[MQTT] Enviando confirmação...
```

### 7.3 Verificar no Dashboard

1. Notificação aparece: **"Alimentação: Felix - 100g"**
2. Histórico é atualizado automaticamente
3. Status é atualizado em tempo real

✅ **FUNCIONA!**

---

## ⏰ PASSO 8: CRIAR HORÁRIO PROGRAMADO

### 8.1 Adicionar Schedule

1. Vá para **"Horários"**
2. Clique em **"Novo Horário"**
3. Preencha:
   - Dispositivo: Alimentador Teste
   - Pet: Felix
   - Hora: 08
   - Minuto: 00
   - Quantidade: 50g
   - Dias: Todos selecionados
4. Clique em **"Criar"**

✅ **Horário criado! Às 08:00 todos os dias, Felix será alimentado automaticamente!**

---

## 🔍 PASSO 9: VERIFICAR LOGS EM TEMPO REAL

### 9.1 Backend Logs

No terminal do backend, você verá:

```bash
[INFO] MQTT message received devices/ESP32_A1B2C3/heartbeat
[INFO] Device status: ESP32_A1B2C3 online
[INFO] WebSocket message sent to user 1
[INFO] Feeding event recorded
```

### 9.2 Serial Monitor ESP32

```
[MQTT] Heartbeat enviado
[SENSOR] Nível compartimento 1: 80%
[MQTT] Telemetria enviada
```

### 9.3 Browser Console

Abra o Console (F12):

```javascript
WebSocket connected
WebSocket authenticated
Device status update: { deviceId: "ESP32_A1B2C3", online: true }
Feeding event: { pet_id: 1, amount: 100 }
```

---

## 🧪 PASSO 10: TESTAR WEBSOCKET REAL-TIME

### 10.1 Abrir Dashboard em 2 Abas

1. Abra o dashboard em uma aba
2. Abra o dashboard em outra aba
3. Na primeira aba, alimente um pet

**Resultado:** A segunda aba atualiza automaticamente! 🎉

### 10.2 Simular Desconexão

1. Pare o backend (`Ctrl+C`)
2. Observe o status: **"Desconectado"**
3. Inicie o backend novamente
4. WebSocket reconecta automaticamente!

---

## 📊 FLUXO DE DADOS COMPLETO

### Alimentação Manual:

```
1. Usuário clica "Alimentar"
   ↓
2. Frontend → fetch() → API REST (POST /api/feed/now)
   ↓
3. Backend → Valida JWT
   ↓
4. Backend → Salva no PostgreSQL
   ↓
5. Backend → MQTT.publish('devices/ESP32_XXX/command')
   ↓
6. ESP32 → MQTT.subscribe() → Recebe comando
   ↓
7. ESP32 → Gira motor
   ↓
8. ESP32 → MQTT.publish('devices/ESP32_XXX/feeding')
   ↓
9. Backend → MQTT.on('message')
   ↓
10. Backend → Atualiza PostgreSQL
    ↓
11. Backend → WebSocket.send() → Todos os clientes
    ↓
12. Frontend → ws.on('feeding') → Atualiza UI
```

### Horário Programado:

```
1. Cron job no backend (ou ESP32)
   ↓
2. Verifica horários ativos
   ↓
3. Backend → MQTT → ESP32
   ↓
4. (Mesmo fluxo da alimentação manual a partir do passo 6)
```

---

## 🎯 CHECKLIST DE VERIFICAÇÃO

### Backend:
- [ ] PostgreSQL rodando
- [ ] Redis rodando
- [ ] MQTT Mosquitto rodando
- [ ] Backend iniciado sem erros
- [ ] Logs mostram "Database: Connected"
- [ ] Logs mostram "MQTT: Connected"

### Frontend:
- [ ] Servidor HTTP rodando (porta 8000)
- [ ] Login funcionando
- [ ] Dashboard carrega
- [ ] WebSocket conectado (ícone verde)

### ESP32:
- [ ] Upload concluído
- [ ] WiFi conectado
- [ ] MQTT conectado
- [ ] Device ID exibido no Serial Monitor
- [ ] Heartbeat sendo enviado

### Integração:
- [ ] Device aparece como "Online" no dashboard
- [ ] Pet foi criado
- [ ] Alimentação manual funciona
- [ ] Motor gira quando alimenta
- [ ] Histórico é atualizado
- [ ] WebSocket atualiza em tempo real

---

## 🐛 TROUBLESHOOTING

### Problema: Backend não conecta ao MQTT

**Solução:**

```bash
# Verificar se Mosquitto está rodando
docker ps | grep mosquitto

# Ver logs
docker logs petfeeder-mqtt

# Reiniciar
docker-compose restart mosquitto
```

### Problema: ESP32 não conecta ao MQTT

**Verificar:**

1. IP está correto?
2. Porta 1883 está aberta no firewall?
3. Usuário/senha estão corretos?
4. WiFi está conectado?

**Testar MQTT manualmente:**

```bash
# Subscrever
mosquitto_sub -h SEU_IP -p 1883 -t 'devices/#' -u server -P server123

# Publicar
mosquitto_pub -h SEU_IP -p 1883 -t 'devices/test' -m 'hello' -u server -P server123
```

### Problema: WebSocket não conecta

1. Verificar se porta 8080 está livre
2. Ver Console do browser (F12)
3. Verificar se backend está rodando
4. Limpar localStorage e fazer login novamente

### Problema: Dispositivo não aparece como Online

1. Verificar Serial Monitor do ESP32
2. Ver se está enviando heartbeat
3. Verificar logs do backend
4. Recarregar o dashboard

---

## 🎉 SUCESSO!

Se tudo funcionou, você agora tem:

✅ **Backend Node.js** rodando com MQTT e WebSocket
✅ **Frontend** conectado à API e WebSocket
✅ **ESP32** comunicando via MQTT
✅ **Dados REAIS** sem mocks
✅ **Atualização em tempo real**
✅ **Sistema completamente funcional!**

---

## 📚 PRÓXIMOS PASSOS

1. **Testar com hardware real** (motores, sensores)
2. **Configurar SSL/TLS** para produção
3. **Deploy em servidor** (VPS, cloud)
4. **Adicionar mais funcionalidades**
5. **Criar app mobile**

---

**🚀 PARABÉNS! SEU PETFEEDER ESTÁ 100% FUNCIONAL E CONECTADO!**
