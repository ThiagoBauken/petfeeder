# 🐾 PetFeeder Pro - Setup Guide

Sistema completo de alimentação automática para pets com ESP32, backend Node.js e frontend interativo.

## 📋 Pré-requisitos

- **Node.js** >= 18.0.0
- **Docker** e **Docker Compose**
- **Python** 3.x (para servir frontend)
- **ESP32** (para hardware)

## 🚀 Iniciando o Projeto

### 1. Iniciar Infraestrutura (Docker)

```bash
# Iniciar PostgreSQL, Redis e MQTT
docker-compose up -d postgres redis mosquitto
```

Serviços disponíveis:
- **PostgreSQL**: `localhost:5432`
- **Redis**: `localhost:6379`
- **MQTT**: `localhost:1883`

### 2. Configurar Backend

```bash
cd backend

# Instalar dependências
npm install

# O arquivo .env já está configurado para desenvolvimento

# Iniciar servidor
npm run dev
```

Backend disponível em:
- **API**: http://localhost:3000
- **WebSocket**: ws://localhost:8080
- **Health Check**: http://localhost:3000/api/health

### 3. Iniciar Frontend

```bash
# Na raiz do projeto
python -m http.server 8000
```

Frontend disponível em: **http://localhost:8000**

## 🎨 Modo Escuro

O frontend possui modo escuro automático:
- Clique no ícone de lua/sol no header
- A preferência é salva localmente

## 📱 Funcionalidades do Frontend

### Dashboard
- Cards dos pets com status em tempo real
- Níveis de ração por compartimento
- Ações rápidas (Alimentar todos, Testar, Emergência)
- Estatísticas do dia

### Dispositivos ESP32
- Adicionar/Remover dispositivos
- Configurar 1-3 motores por ESP32
- Associar motores a pets
- Status online/offline
- Calibração individual

### Meus Pets
- Configurar até 3 pets
- Tamanhos de porção: Pequena (15g), Média (30g), Grande (50g)
- Quantidade diária e refeições
- Associar dispositivo ESP32

### Horários
- Programar alimentação automática
- Selecionar dias da semana
- Configurar quantidade por horário

### Histórico
- Registro completo de alimentações
- Gráfico de consumo semanal
- Filtros por pet e tipo
- Exportar CSV

### Configurações
- WiFi
- Calibração de motores (Steps/grama)
- Notificações

## 🔧 Configuração ESP32

### 1. Configurar no código

```cpp
// ESP32_SaaS_Client.ino

const char* wifi_ssid = "SUA_REDE_WIFI";
const char* wifi_password = "SUA_SENHA";
const char* MQTT_SERVER = "SEU_SERVIDOR";  // localhost ou IP
```

### 2. Upload para ESP32

```bash
# Usando Arduino IDE ou PlatformIO
```

### 3. Adicionar dispositivo no Frontend

1. Acesse **Dispositivos**
2. Clique em **Adicionar Novo Dispositivo**
3. Digite o Device ID (ex: PF_AABBCC001122)
4. Configure os motores e associe aos pets

## 🎯 Calibração

### Motores de Passo (28BYJ-48)

1. Monte o hardware
2. Acesse **Dispositivos** ou **Configurações**
3. Teste com pequenas quantidades
4. Ajuste **Steps por Grama**:
   - Padrão: 41 steps/grama
   - Teste: Dispense 50g e meça o resultado
   - Ajuste: `steps/grama = (steps_usados × 50) / gramas_reais`

### Velocidade do Motor

- Delay em microsegundos entre steps
- Menor = mais rápido
- Maior = mais preciso
- Padrão: 2000µs

## 📊 Estrutura de Dados

### Tamanhos de Porção
- **Pequena**: 15g
- **Média**: 30g
- **Grande**: 50g
- **Personalizado**: 5-100g

### Histórico
Armazenado localmente (localStorage):
- Timestamp
- Pet
- Quantidade
- Tipo (manual/programado)
- Status

## 🐛 Troubleshooting

### Backend não conecta ao MQTT
```bash
# Verificar se Mosquitto está rodando
docker ps | grep mosquitto

# Ver logs
docker logs petfeeder-mqtt
```

### Frontend não conecta ao WebSocket
- Verifique se o backend está rodando na porta 8080
- URL WebSocket: `ws://localhost:8080`

### ESP32 não conecta
1. Verifique WiFi
2. Verifique IP do servidor MQTT
3. Verifique porta 1883 aberta
4. Ver logs serial (115200 baud)

## 📦 Estrutura do Projeto

```
petfeeder/
├── index.html              # Frontend principal
├── style.css               # Estilos + Dark Mode
├── script.js               # Lógica do frontend
├── backend/                # Servidor Node.js
│   ├── server.js          # Servidor principal
│   ├── src/               # Código fonte
│   │   ├── config/        # Configurações
│   │   ├── routes/        # Rotas da API
│   │   ├── controllers/   # Controladores
│   │   ├── services/      # Serviços (MQTT, WS)
│   │   └── middlewares/   # Middlewares
│   └── .env               # Variáveis de ambiente
├── docker-compose.yml      # Infraestrutura
└── *.ino                  # Código ESP32
```

## 🔒 Segurança

### Desenvolvimento
- Senhas padrão no `.env`
- CORS aberto para localhost

### Produção
- Altere TODAS as senhas
- Configure SSL/TLS
- Restrinja CORS
- Use variáveis de ambiente seguras
- Ative autenticação MQTT

## 📝 Próximos Passos

1. ✅ Frontend completo e funcional
2. ✅ Backend com WebSocket e MQTT
3. ✅ Modo escuro
4. ⏳ Montar hardware ESP32
5. ⏳ Calibrar motores com valores reais
6. ⏳ Deploy em produção

## 💡 Dicas

- Use **PostgreSQL** para dados persistentes
- Use **Redis** para cache e sessões
- **MQTT** para comunicação ESP32
- **WebSocket** para updates em tempo real
- **localStorage** para preferências do usuário

## 🆘 Suporte

Em caso de dúvidas:
1. Verifique os logs: `backend/logs/`
2. Console do navegador (F12)
3. Logs do Docker: `docker-compose logs`
4. Serial do ESP32

---

**Status do Projeto**: ✅ Frontend e Backend 100% funcionais!
