# 🐾 PetFeeder

Alimentador automático de pets controlado por um ESP32 (motor 28BYJ-48 + sensor de nível HC-SR04), com um painel web para criar horários, alimentar na hora e acompanhar o histórico e o nível de ração.

> Projeto consolidado: **um** backend, **um** frontend e **um** firmware. Versões duplicadas/legadas e componentes que não funcionavam foram removidos.

---

## Como funciona

```
┌──────────────┐   HTTP polling (HTTPS)   ┌──────────────────────────┐   HTTP + WebSocket   ┌─────────────┐
│   ESP32      │ ───────────────────────► │  Backend (Node.js)       │ ◄──────────────────► │  Navegador  │
│ 28BYJ-48 +   │  /auto-register          │  Express + SQLite        │   REST /api/*        │  (frontend  │
│ HC-SR04      │  /schedules /commands    │  WebSocket em /ws         │   tempo real /ws     │   estático) │
│              │  /status   /feed/log     │  serve o frontend        │                      │             │
└──────────────┘  (X-Device-Secret)       └──────────────────────────┘                      └─────────────┘
```

- **Container único**: o backend Node.js serve a API REST, o WebSocket (no path `/ws`) **e** o frontend estático — tudo na mesma porta.
- **Banco**: SQLite (arquivo persistente em produção).
- **ESP32 ↔ servidor**: o aparelho faz *polling* HTTP autenticado por um **segredo por dispositivo** (`X-Device-Secret`) emitido no registro. Os horários são executados **no próprio ESP32** (funciona offline; sincroniza quando há internet).
- **Tempo real**: o navegador recebe status do dispositivo, alertas de nível baixo e confirmações de alimentação por WebSocket.

## Stack

- **Backend**: Node.js + Express, SQLite (`sqlite3`), `ws` (WebSocket), `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, CORS com allowlist.
- **Frontend**: HTML/CSS/JavaScript puro (sem framework), servido pelo backend.
- **Firmware**: ESP32 (Arduino), bibliotecas do core ESP32 + `ArduinoJson`.

## Estrutura

```
backend/                  API REST + WebSocket + SQLite (server.js)
frontend/                 painel web (login, dashboard, flash, setup-guide)
PetFeeder_WiFiSetup/      firmware oficial do ESP32 (Arduino)
examples/                 sketches de teste de bancada (motor, sensor)
docs/hardware/            guias de montagem, fiação, calibração e compras
Dockerfile, docker-compose.yml, .env.example
```

---

## Rodando em desenvolvimento

```bash
cd backend
npm install
# Em dev, se não definir os segredos, o servidor gera segredos efêmeros e avisa.
# Para tokens estáveis entre reinícios, defina-os:
#   PowerShell:  $env:JWT_SECRET="..."; $env:JWT_REFRESH_SECRET="..."
npm run dev        # ou: npm start
```

Acesse `http://localhost:3000`. Em dev o banco é em memória (`:memory:`) por padrão — defina `DB_PATH` para persistir.

### Testes

Com o servidor rodando em outro terminal:

```bash
cd backend
npm test
```

São testes de integração contra a API real (37 asserções): autenticação, isolamento entre contas, autenticação de dispositivo por `X-Device-Secret`, isolamento de horários por dispositivo, validação de entrada, fila de comandos e WebSocket.

## Rodando com Docker (produção)

```bash
cp .env.example .env
# edite o .env e gere segredos fortes:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up -d --build
```

Acesse `http://localhost:8080` (ou a `HTTP_PORT` configurada). O SQLite fica no volume `petfeeder-data`.

Atrás de um proxy (ex.: Easypanel/Traefik/Nginx), aponte o domínio para a porta `3000` do container — o WebSocket usa a **mesma origem** em `/ws`, então não precisa de porta separada.

## Configurando o ESP32

1. Grave o firmware `PetFeeder_WiFiSetup/` pelo Arduino IDE (placa "ESP32 Dev Module"; instale o suporte ESP32 + biblioteca `ArduinoJson`). A página `flash.html` do painel tem o passo a passo.
2. Ao ligar, o ESP32 cria a rede **`PetFeeder-Setup`** (senha `12345678`). Conecte-se por ela pelo celular.
3. Informe a rede WiFi e o **e-mail da sua conta** no PetFeeder. O aparelho se registra sozinho e recebe um segredo.
4. No painel, crie o pet, vincule ao dispositivo e configure os horários.

> Antes de gravar, ajuste no firmware os pinos e a calibração conforme `docs/hardware/` (motor, sensor e gramas por dose).

---

## Segurança

- Segredos JWT **lidos do ambiente** (obrigatórios em produção; o servidor aborta se faltarem). Nada de segredo hardcoded.
- Rotas do ESP32 (`/commands`, `/status`, `/schedules`, `/feed/log`) **autenticadas** por `X-Device-Secret` (segredo por dispositivo, comparado em tempo constante, com proteção anti-sequestro no registro).
- `helmet` + **Content-Security-Policy** com `connect-src 'self'`: mesmo que algum HTML injetado execute, não consegue enviar os tokens para fora.
- **CORS com allowlist** (`CORS_ORIGINS`) e **rate limiting** nas rotas de autenticação.
- Todo dado exibido no dashboard passa por **escape de HTML**; dados vindos do dispositivo (nível, IP, modo) são **sanitizados na entrada**.
- Senhas com `bcrypt`. O **logout revoga access e refresh** de uma vez (`token_version`), de forma persistente — sobrevive ao restart do servidor.
- Validação de tipo e faixa nas rotas de escrita; container roda como usuário **não-root**.

## Limitações conhecidas / não implementado

Para evitar a inflação do README antigo, o que **não** existe hoje (e poderia ser um próximo passo):

- **Sem** pagamentos/Stripe, planos pagos, app mobile, MQTT, Grafana/Prometheus, 2FA, recuperação de senha por e-mail, câmera/vídeo. (O `plan` do usuário é sempre `free`.)
- A **fila de comandos** ao ESP32 é em memória (some se o backend reiniciar) — adequada a uma única instância; os dados (usuários, pets, horários, histórico, nível) ficam no SQLite.
- As **gramas por dose** (50/100/150 g) são valores de calibração padrão; ajuste em `docs/hardware/GUIA_CALIBRACAO.md`.
- O firmware usa `setInsecure()` no cliente HTTPS (não valida o certificado do servidor). Para endurecer, embarque a CA raiz do seu provedor.
- A URL do servidor está fixa no firmware (`PetFeeder_WiFiSetup.ino`, constante `serverUrl`) — **edite antes de gravar** se você subir a sua própria instância.
- Os testes cobrem a API por integração; **não há** testes unitários, de frontend nem do firmware.
- `PRAGMA foreign_keys` não é ligado: apagar um dispositivo ainda deixa horários/histórico órfãos.
- **Multi-pet por dispositivo**: o campo "compartimento" existe no cadastro, mas o firmware aciona um único motor — dois pets no mesmo aparelho comem do mesmo funil.
- A dispensa (`dispense()`) é bloqueante (até ~22 s na dose grande) e não há watchdog no firmware.

### Escolha do dispositivo e segurança do pareamento

O `auto-register` é autenticado apenas pelo **e-mail da conta**. Quem souber o e-mail e o `device_id` consegue parear um aparelho na conta. Re-vincular um dispositivo já pareado **para outra conta** exige o segredo correto, mas o primeiro pareamento não tem segundo fator. Um código de pareamento de uso único resolveria isso.

## Hardware

Guias completos de componentes, fiação, alimentação elétrica, sensor, motor e calibração estão em [`docs/hardware/`](docs/hardware/).

## Licença

MIT.
