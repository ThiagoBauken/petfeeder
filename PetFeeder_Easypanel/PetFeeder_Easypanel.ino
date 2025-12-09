/*
 * ═══════════════════════════════════════════════════════════════════
 * PetFeeder ESP32 - VERSÃO COM AUTO-REGISTRO + DEEP SLEEP INTELIGENTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * FLUXO:
 * 1. Liga → Portal WiFi + Email
 * 2. Conecta → Registra dispositivo no servidor
 * 3. SEM horários → Fica ACORDADO (polling a cada 30s)
 * 4. COM horários → Ativa Deep Sleep
 *
 * PINOS:
 * Motor: GPIO 16, 17, 18, 19
 * Sensor: TRIG=23, ECHO=22
 *
 * ═══════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include <esp_sleep.h>

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURACAO
// ══════════════════════════════════════════════════════════════════

const char* SERVER_URL = "https://telegram-petfeeder.pbzgje.easypanel.host";
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET = -3 * 3600;  // Brasil (GMT-3)

// Intervalo para buscar atualizacoes
#define SYNC_INTERVAL_HOURS 6
#define POLL_INTERVAL_MS 30000  // 30 segundos quando sem horarios

// ══════════════════════════════════════════════════════════════════
//                    PINOS DO HARDWARE
// ══════════════════════════════════════════════════════════════════

#define MOTOR_IN1 16
#define MOTOR_IN2 17
#define MOTOR_IN3 18
#define MOTOR_IN4 19
#define TRIG_PIN 23
#define ECHO_PIN 22
#define LED_PIN 2

// ══════════════════════════════════════════════════════════════════
//                    DOSES
// ══════════════════════════════════════════════════════════════════

const int DOSE_SMALL = 2048;   // 1 volta (~50g)
const int DOSE_MEDIUM = 4096;  // 2 voltas (~100g)
const int DOSE_LARGE = 6144;   // 3 voltas (~150g)

// Half-step sequence
const int stepSequence[8][4] = {
  {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0},
  {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}
};

// ══════════════════════════════════════════════════════════════════
//                    ESTRUTURAS DE DADOS
// ══════════════════════════════════════════════════════════════════

#define MAX_SCHEDULES 10

struct Schedule {
  uint8_t hour;
  uint8_t minute;
  uint8_t doseType;  // 1=small, 2=medium, 3=large
  uint8_t days;      // Bitmask: bit0=Dom, bit1=Seg, ..., bit6=Sab
  bool active;
};

struct Config {
  char wifi_ssid[32];
  char wifi_pass[64];
  char user_email[64];  // Email do usuario para vincular
  bool configured;
  bool registered;      // Se ja foi registrado no servidor
  Schedule schedules[MAX_SCHEDULES];
  uint8_t scheduleCount;
  uint32_t lastSync;
};

// ══════════════════════════════════════════════════════════════════
//                    VARIAVEIS GLOBAIS
// ══════════════════════════════════════════════════════════════════

Config config;
Preferences preferences;
WebServer server(80);
WiFiClientSecure httpsClient;

String DEVICE_ID = "";
int currentStep = 0;
float foodLevel = 0;
bool isAPMode = false;
bool isWaitingConfig = false;  // Aguardando configuracao de horarios
unsigned long lastPollTime = 0;

// Motivo do wakeup
RTC_DATA_ATTR int bootCount = 0;

// ══════════════════════════════════════════════════════════════════
//                    SETUP
// ══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  bootCount++;

  // Gera Device ID baseado no MAC
  uint8_t mac[6];
  WiFi.macAddress(mac);
  DEVICE_ID = String(mac[3], HEX) + String(mac[4], HEX) + String(mac[5], HEX);
  DEVICE_ID.toUpperCase();

  Serial.println("\n");
  Serial.println("======================================================");
  Serial.println("    PetFeeder ESP32 - AUTO-REGISTRO + DEEP SLEEP");
  Serial.println("======================================================");
  Serial.printf("Device ID: %s\n", DEVICE_ID.c_str());
  Serial.printf("Boot #%d\n", bootCount);

  // Configura pinos
  setupHardware();

  // Carrega configuracao da flash
  loadConfig();

  // Verifica motivo do wakeup
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_TIMER:
      Serial.println("[TIMER] Acordou para alimentar ou sincronizar");
      handleScheduledWakeup();
      break;

    case ESP_SLEEP_WAKEUP_EXT0:
      Serial.println("[BOTAO] Acordou por botao fisico");
      handleManualFeed();
      break;

    default:
      Serial.println("[BOOT] Inicializacao normal");
      handleNormalBoot();
      break;
  }
}

void loop() {
  // Modo AP - portal de configuracao WiFi
  if (isAPMode) {
    server.handleClient();
    blinkLED(500);
    return;
  }

  // Modo aguardando configuracao de horarios
  if (isWaitingConfig) {
    server.handleClient();  // Permite alimentar manualmente via /feed
    blinkLED(1000);  // LED pisca mais devagar

    // Polling periodico para verificar novos horarios
    if (millis() - lastPollTime > POLL_INTERVAL_MS) {
      lastPollTime = millis();
      Serial.println("\n[POLL] Verificando novos horarios...");

      if (syncWithServer()) {
        if (config.scheduleCount > 0) {
          Serial.println("[OK] Horarios configurados! Ativando Deep Sleep...");
          isWaitingConfig = false;
          scheduleNextWakeup();
        } else {
          Serial.println("[AGUARDANDO] Nenhum horario ainda. Configure pelo site.");
        }
      }

      // Envia status
      sendStatus();
    }
    return;
  }
}

// ══════════════════════════════════════════════════════════════════
//                    HANDLERS DE BOOT
// ══════════════════════════════════════════════════════════════════

void handleNormalBoot() {
  // Nao configurado? Inicia portal
  if (!config.configured) {
    Serial.println("[CONFIG] Nao configurado. Iniciando portal...");
    startConfigPortal();
    return;
  }

  // Tenta conectar WiFi
  if (!connectWiFi(config.wifi_ssid, config.wifi_pass, 20)) {
    Serial.println("[ERRO] Falha ao conectar WiFi");
    // Se tem horarios salvos, usa offline
    if (config.scheduleCount > 0) {
      Serial.println("[OFFLINE] Usando horarios salvos...");
      scheduleNextWakeup();
    } else {
      // Sem WiFi e sem horarios, reinicia portal
      Serial.println("[ERRO] Sem WiFi e sem horarios. Reiniciando portal...");
      config.configured = false;
      saveConfig();
      ESP.restart();
    }
    return;
  }

  Serial.println("[OK] WiFi conectado!");
  Serial.printf("[IP] %s\n", WiFi.localIP().toString().c_str());

  // Sincroniza horario NTP
  syncTime();

  // Registra dispositivo se ainda nao foi
  if (!config.registered) {
    if (registerDevice()) {
      config.registered = true;
      saveConfig();
    }
  }

  // Sincroniza horarios com servidor
  syncWithServer();

  // Envia status
  sendStatus();

  // Verifica comandos pendentes
  checkCommands();

  // Decide: Deep Sleep ou aguardar configuracao
  if (config.scheduleCount > 0) {
    Serial.println("[OK] Horarios configurados. Ativando Deep Sleep...");
    scheduleNextWakeup();
  } else {
    Serial.println("[AGUARDANDO] Sem horarios. Aguardando configuracao...");
    Serial.println(">>> Configure os horarios pelo site <<<");
    isWaitingConfig = true;
    lastPollTime = millis();

    // Inicia servidor local para alimentar manualmente
    setupLocalServer();
  }
}

void handleScheduledWakeup() {
  // Conecta WiFi rapidamente
  if (!connectWiFi(config.wifi_ssid, config.wifi_pass, 10)) {
    Serial.println("[OFFLINE] Sem WiFi, usando horarios salvos");
  } else {
    syncTime();
  }

  // Verifica qual horario disparou
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[ERRO] Sem hora. Sincronizando...");
    if (WiFi.status() == WL_CONNECTED) {
      syncWithServer();
    }
    scheduleNextWakeup();
    return;
  }

  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday;

  Serial.printf("[HORA] %02d:%02d (dia %d)\n", currentHour, currentMinute, currentDay);

  // Procura horario que disparou
  bool fed = false;
  for (int i = 0; i < config.scheduleCount; i++) {
    Schedule& s = config.schedules[i];

    if (!s.active) continue;
    if (!(s.days & (1 << currentDay))) continue;

    int scheduleMins = s.hour * 60 + s.minute;
    int currentMins = currentHour * 60 + currentMinute;

    if (abs(scheduleMins - currentMins) <= 2) {
      Serial.printf("[ALIMENTAR] Horario %02d:%02d\n", s.hour, s.minute);

      int steps = DOSE_MEDIUM;
      if (s.doseType == 1) steps = DOSE_SMALL;
      else if (s.doseType == 3) steps = DOSE_LARGE;

      dispense(steps);
      fed = true;

      // Log no servidor
      if (WiFi.status() == WL_CONNECTED) {
        sendFeedingLog(s.doseType == 1 ? "small" : (s.doseType == 3 ? "large" : "medium"), steps);
        sendStatus();
      }

      break;
    }
  }

  // Sincroniza se necessario
  if (WiFi.status() == WL_CONNECTED && needsSync()) {
    syncWithServer();
  }

  // Agenda proximo wakeup
  scheduleNextWakeup();
}

void handleManualFeed() {
  Serial.println("[MANUAL] Alimentacao por botao");
  dispense(DOSE_MEDIUM);

  if (connectWiFi(config.wifi_ssid, config.wifi_pass, 10)) {
    sendFeedingLog("medium", DOSE_MEDIUM);
    sendStatus();
  }

  scheduleNextWakeup();
}

// ══════════════════════════════════════════════════════════════════
//                    REGISTRO NO SERVIDOR
// ══════════════════════════════════════════════════════════════════

bool registerDevice() {
  Serial.println("[REGISTRO] Registrando dispositivo...");

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/auto-register";

  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["email"] = config.user_email;
  doc["name"] = "PetFeeder " + DEVICE_ID;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.printf("[REGISTRO] Resposta: %d\n", code);

  if (code == 200 || code == 201) {
    Serial.println("[OK] Dispositivo registrado com sucesso!");
    return true;
  } else {
    Serial.printf("[ERRO] Falha no registro: %s\n", response.c_str());
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════
//                    SINCRONIZACAO COM SERVIDOR
// ══════════════════════════════════════════════════════════════════

bool needsSync() {
  uint32_t now = time(nullptr);
  uint32_t hoursSinceSync = (now - config.lastSync) / 3600;
  return hoursSinceSync >= SYNC_INTERVAL_HOURS;
}

bool syncWithServer() {
  Serial.println("[SYNC] Buscando horarios...");

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/schedules";

  http.begin(httpsClient, url);
  int code = http.GET();

  if (code == 200) {
    String response = http.getString();
    parseSchedules(response);
    config.lastSync = time(nullptr);
    saveConfig();
    Serial.printf("[OK] %d horarios sincronizados\n", config.scheduleCount);
    http.end();
    return true;
  } else {
    Serial.printf("[ERRO] Sync falhou: %d\n", code);
    http.end();
    return false;
  }
}

void parseSchedules(String json) {
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, json);

  if (error) {
    Serial.println("[ERRO] JSON invalido");
    return;
  }

  JsonArray schedules = doc["data"].as<JsonArray>();
  config.scheduleCount = 0;

  for (JsonObject s : schedules) {
    if (config.scheduleCount >= MAX_SCHEDULES) break;

    Schedule& sch = config.schedules[config.scheduleCount];
    sch.hour = s["hour"] | 0;
    sch.minute = s["minute"] | 0;
    sch.active = s["active"] | true;

    // Dose type
    String size = s["size"] | "medium";
    if (size == "small") sch.doseType = 1;
    else if (size == "large") sch.doseType = 3;
    else sch.doseType = 2;

    // Days bitmask
    sch.days = 0;
    JsonArray days = s["days"].as<JsonArray>();
    for (int d : days) {
      sch.days |= (1 << d);
    }

    config.scheduleCount++;
    Serial.printf("   [%d] %02d:%02d dose=%d dias=0x%02X\n",
                  config.scheduleCount, sch.hour, sch.minute, sch.doseType, sch.days);
  }
}

void checkCommands() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/commands";

  http.begin(httpsClient, url);
  int code = http.GET();

  if (code == 200) {
    String response = http.getString();
    StaticJsonDocument<256> doc;

    if (!deserializeJson(doc, response) && doc.containsKey("command")) {
      String cmd = doc["command"].as<String>();

      if (cmd == "feed") {
        String size = doc["size"] | "medium";
        int steps = DOSE_MEDIUM;

        if (size == "small") steps = DOSE_SMALL;
        else if (size == "large") steps = DOSE_LARGE;

        Serial.println("[COMANDO] Alimentar: " + size);
        dispense(steps);
        sendFeedingLog(size, steps);
      } else if (cmd == "sync") {
        syncWithServer();
      }
    }
  }

  http.end();
}

// ══════════════════════════════════════════════════════════════════
//                    DEEP SLEEP
// ══════════════════════════════════════════════════════════════════

void scheduleNextWakeup() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[SLEEP] Sem hora. Dormindo 1 hora...");
    goToSleep(3600);
    return;
  }

  int currentMins = timeinfo.tm_hour * 60 + timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday;
  int minSleepMins = 24 * 60;
  bool foundSchedule = false;

  // Procura proximo horario
  for (int dayOffset = 0; dayOffset < 7; dayOffset++) {
    int checkDay = (currentDay + dayOffset) % 7;

    for (int i = 0; i < config.scheduleCount; i++) {
      Schedule& s = config.schedules[i];

      if (!s.active) continue;
      if (!(s.days & (1 << checkDay))) continue;

      int scheduleMins = s.hour * 60 + s.minute;

      if (dayOffset == 0 && scheduleMins <= currentMins + 1) continue;

      int sleepMins;
      if (dayOffset == 0) {
        sleepMins = scheduleMins - currentMins;
      } else {
        sleepMins = (24 * 60 - currentMins) + (dayOffset - 1) * 24 * 60 + scheduleMins;
      }

      if (sleepMins < minSleepMins) {
        minSleepMins = sleepMins;
        foundSchedule = true;
      }
    }

    if (foundSchedule && dayOffset == 0) break;
  }

  if (foundSchedule) {
    int syncMins = SYNC_INTERVAL_HOURS * 60;
    if (minSleepMins > syncMins) {
      minSleepMins = syncMins;
      Serial.printf("[SLEEP] Sync em %d min\n", minSleepMins);
    } else {
      Serial.printf("[SLEEP] Alimentacao em %d min\n", minSleepMins);
    }
  } else {
    minSleepMins = SYNC_INTERVAL_HOURS * 60;
    Serial.printf("[SLEEP] Sem horarios. Sync em %d min\n", minSleepMins);
  }

  goToSleep(minSleepMins * 60);
}

void goToSleep(uint32_t seconds) {
  Serial.printf("[SLEEP] Dormindo por %d segundos...\n\n", seconds);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  stopMotor();

  esp_sleep_enable_timer_wakeup(seconds * 1000000ULL);
  esp_deep_sleep_start();
}

// ══════════════════════════════════════════════════════════════════
//                    MOTOR
// ══════════════════════════════════════════════════════════════════

void dispense(int steps) {
  Serial.printf("[MOTOR] Dispensando %d passos...\n", steps);
  digitalWrite(LED_PIN, HIGH);

  for (int i = 0; i < steps; i++) {
    setStep(stepSequence[currentStep][0],
            stepSequence[currentStep][1],
            stepSequence[currentStep][2],
            stepSequence[currentStep][3]);
    currentStep = (currentStep + 1) % 8;
    delayMicroseconds(1200);
  }

  stopMotor();
  digitalWrite(LED_PIN, LOW);

  readSensor();
  Serial.println("[OK] Alimentacao concluida!");
}

void setStep(int a, int b, int c, int d) {
  digitalWrite(MOTOR_IN1, a);
  digitalWrite(MOTOR_IN2, b);
  digitalWrite(MOTOR_IN3, c);
  digitalWrite(MOTOR_IN4, d);
}

void stopMotor() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
}

// ══════════════════════════════════════════════════════════════════
//                    SENSOR
// ══════════════════════════════════════════════════════════════════

void readSensor() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  float distanceCm = duration * 0.034 / 2;

  if (distanceCm < 5) foodLevel = 100;
  else if (distanceCm > 20) foodLevel = 0;
  else foodLevel = map(distanceCm, 20, 5, 0, 100);

  Serial.printf("[SENSOR] Nivel: %.0f%% (%.1fcm)\n", foodLevel, distanceCm);
}

// ══════════════════════════════════════════════════════════════════
//                    WIFI & TIME
// ══════════════════════════════════════════════════════════════════

bool connectWiFi(const char* ssid, const char* pass, int timeoutSec) {
  Serial.printf("[WIFI] Conectando a %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < timeoutSec * 2) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  httpsClient.setInsecure();
  return WiFi.status() == WL_CONNECTED;
}

void syncTime() {
  configTime(GMT_OFFSET, 0, NTP_SERVER);

  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10000)) {
    Serial.printf("[NTP] Hora: %02d:%02d:%02d\n",
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    HTTP - ENVIO DE DADOS
// ══════════════════════════════════════════════════════════════════

void sendStatus() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/status";

  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["online"] = true;
  doc["food_level"] = foodLevel;
  doc["schedules_count"] = config.scheduleCount;
  doc["boot_count"] = bootCount;
  doc["waiting_config"] = isWaitingConfig;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

void sendFeedingLog(String size, int steps) {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/feed/log";

  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["size"] = size;
  doc["steps"] = steps;
  doc["food_level_after"] = foodLevel;
  doc["trigger"] = "scheduled";

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

// ══════════════════════════════════════════════════════════════════
//                    PORTAL DE CONFIGURACAO (WiFi + Email)
// ══════════════════════════════════════════════════════════════════

void startConfigPortal() {
  isAPMode = true;

  String apName = "PetFeeder_" + DEVICE_ID;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str(), "12345678");

  Serial.println("\n========================================");
  Serial.println("    PORTAL DE CONFIGURACAO");
  Serial.println("========================================");
  Serial.println("WiFi: " + apName);
  Serial.println("Senha: 12345678");
  Serial.println("URL: http://192.168.4.1");
  Serial.println("========================================\n");

  setupWebRoutes();
  server.begin();
}

void setupWebRoutes() {
  // Pagina principal - formulario de configuracao
  server.on("/", HTTP_GET, []() {
    String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PetFeeder Setup</title>
  <style>
    *{box-sizing:border-box;font-family:Arial,sans-serif}
    body{margin:0;padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh}
    .card{background:#fff;border-radius:20px;padding:30px;max-width:400px;margin:0 auto;box-shadow:0 10px 40px rgba(0,0,0,.2)}
    h1{color:#333;text-align:center;margin-bottom:5px}
    .sub{color:#666;text-align:center;margin-bottom:25px}
    label{display:block;color:#333;font-weight:bold;margin-top:15px;margin-bottom:5px}
    input{width:100%;padding:15px;border:2px solid #ddd;border-radius:10px;font-size:16px}
    input:focus{border-color:#667eea;outline:none}
    button{width:100%;padding:15px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;font-size:18px;cursor:pointer;margin-top:25px}
    button:hover{opacity:0.9}
    .icon{font-size:60px;text-align:center}
    .info{background:#f0f4ff;padding:15px;border-radius:10px;margin-top:20px;font-size:13px;color:#555;border-left:4px solid #667eea}
    .warn{background:#fff3cd;border-left-color:#ffc107;margin-top:10px}
    .device{background:#e8f5e9;padding:10px;border-radius:8px;text-align:center;margin-bottom:15px;font-family:monospace;font-size:18px;color:#2e7d32}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128054;</div>
    <h1>PetFeeder</h1>
    <p class="sub">Configure seu alimentador</p>

    <div class="device">)" + DEVICE_ID + R"(</div>

    <form action="/save" method="POST">
      <label>Email da sua conta *</label>
      <input type="email" name="email" placeholder="seu@email.com" required>

      <label>Nome da rede WiFi *</label>
      <input type="text" name="ssid" placeholder="Nome do WiFi" required>

      <label>Senha do WiFi *</label>
      <input type="password" name="pass" placeholder="Senha" required>

      <button type="submit">Salvar e Conectar</button>
    </form>

    <div class="info">
      <strong>Importante:</strong> Use o mesmo email que voce cadastrou no site.
      O dispositivo sera vinculado automaticamente a sua conta.
    </div>

    <div class="info warn">
      <strong>Proximo passo:</strong> Apos conectar, configure os horarios de alimentacao pelo site.
    </div>
  </div>
</body>
</html>
)";
    server.send(200, "text/html", html);
  });

  // Salvar configuracao
  server.on("/save", HTTP_POST, []() {
    String email = server.arg("email");
    String ssid = server.arg("ssid");
    String pass = server.arg("pass");

    email.toLowerCase();
    email.toCharArray(config.user_email, 64);
    ssid.toCharArray(config.wifi_ssid, 32);
    pass.toCharArray(config.wifi_pass, 64);
    config.configured = true;
    config.registered = false;  // Precisa registrar
    config.scheduleCount = 0;
    saveConfig();

    String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;font-family:Arial;display:flex;align-items:center;justify-content:center}
    .card{background:#fff;border-radius:20px;padding:40px;text-align:center;max-width:400px}
    .icon{font-size:80px}
    h1{color:#333}
    p{color:#666;line-height:1.6}
    .steps{background:#f0f4ff;padding:20px;border-radius:10px;text-align:left;margin-top:20px}
    .steps li{margin:10px 0;color:#444}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#9989;</div>
    <h1>Configurado!</h1>
    <p>O dispositivo vai reiniciar e conectar ao WiFi.</p>

    <div class="steps">
      <strong>Proximos passos:</strong>
      <ol>
        <li>Aguarde o LED parar de piscar</li>
        <li>Acesse o site e faca login</li>
        <li>Configure os horarios de alimentacao</li>
        <li>O dispositivo ativara o modo economico automaticamente</li>
      </ol>
    </div>
  </div>
</body>
</html>
)";
    server.send(200, "text/html", html);
    delay(2000);
    ESP.restart();
  });
}

// Servidor local para quando esta aguardando configuracao
void setupLocalServer() {
  server.on("/", HTTP_GET, []() {
    String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PetFeeder</title>
  <style>
    *{box-sizing:border-box;font-family:Arial}
    body{margin:0;padding:20px;background:#f5f5f5;min-height:100vh}
    .card{background:#fff;border-radius:15px;padding:25px;max-width:400px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.1)}
    h1{text-align:center;color:#333}
    .status{background:#fff3cd;padding:15px;border-radius:10px;margin:20px 0;text-align:center}
    .btn{display:block;width:100%;padding:15px;margin:10px 0;border:none;border-radius:10px;font-size:16px;cursor:pointer}
    .btn-feed{background:#4CAF50;color:#fff}
    .info{font-size:13px;color:#666;text-align:center;margin-top:20px}
  </style>
</head>
<body>
  <div class="card">
    <h1>PetFeeder )" + DEVICE_ID + R"(</h1>

    <div class="status">
      <strong>Aguardando configuracao</strong><br>
      Configure os horarios pelo site
    </div>

    <button class="btn btn-feed" onclick="feed('medium')">Alimentar Agora (Media)</button>
    <button class="btn btn-feed" onclick="feed('small')" style="background:#8BC34A">Porcao Pequena</button>
    <button class="btn btn-feed" onclick="feed('large')" style="background:#FF9800">Porcao Grande</button>

    <p class="info">
      IP: )" + WiFi.localIP().toString() + R"(<br>
      Nivel de racao: )" + String(foodLevel, 0) + R"(%
    </p>
  </div>

  <script>
  function feed(size) {
    fetch('/feed?size=' + size)
      .then(r => r.json())
      .then(d => alert(d.success ? 'Alimentando!' : 'Erro'))
      .catch(e => alert('Erro: ' + e));
  }
  </script>
</body>
</html>
)";
    server.send(200, "text/html", html);
  });

  server.on("/feed", HTTP_GET, []() {
    String size = server.arg("size");
    int steps = DOSE_MEDIUM;
    if (size == "small") steps = DOSE_SMALL;
    else if (size == "large") steps = DOSE_LARGE;

    dispense(steps);

    if (WiFi.status() == WL_CONNECTED) {
      sendFeedingLog(size, steps);
    }

    server.send(200, "application/json", "{\"success\":true}");
  });

  server.on("/status", HTTP_GET, []() {
    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["food_level"] = foodLevel;
    doc["schedules"] = config.scheduleCount;
    doc["waiting_config"] = isWaitingConfig;

    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
  });

  server.begin();
  Serial.printf("[SERVER] Local em http://%s\n", WiFi.localIP().toString().c_str());
}

// ══════════════════════════════════════════════════════════════════
//                    CONFIG (FLASH)
// ══════════════════════════════════════════════════════════════════

void loadConfig() {
  preferences.begin("petfeeder", true);

  preferences.getString("ssid", config.wifi_ssid, 32);
  preferences.getString("pass", config.wifi_pass, 64);
  preferences.getString("email", config.user_email, 64);
  config.configured = preferences.getBool("configured", false);
  config.registered = preferences.getBool("registered", false);
  config.scheduleCount = preferences.getUChar("schCount", 0);
  config.lastSync = preferences.getUInt("lastSync", 0);

  for (int i = 0; i < config.scheduleCount && i < MAX_SCHEDULES; i++) {
    String key = "sch" + String(i);
    preferences.getBytes(key.c_str(), &config.schedules[i], sizeof(Schedule));
  }

  preferences.end();

  Serial.printf("[CONFIG] Email: %s, Horarios: %d\n",
    config.user_email, config.scheduleCount);
}

void saveConfig() {
  preferences.begin("petfeeder", false);

  preferences.putString("ssid", config.wifi_ssid);
  preferences.putString("pass", config.wifi_pass);
  preferences.putString("email", config.user_email);
  preferences.putBool("configured", config.configured);
  preferences.putBool("registered", config.registered);
  preferences.putUChar("schCount", config.scheduleCount);
  preferences.putUInt("lastSync", config.lastSync);

  for (int i = 0; i < config.scheduleCount && i < MAX_SCHEDULES; i++) {
    String key = "sch" + String(i);
    preferences.putBytes(key.c_str(), &config.schedules[i], sizeof(Schedule));
  }

  preferences.end();
  Serial.println("[CONFIG] Salvo na flash!");
}

// ══════════════════════════════════════════════════════════════════
//                    HARDWARE
// ══════════════════════════════════════════════════════════════════

void setupHardware() {
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  stopMotor();
}

void blinkLED(int interval) {
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > interval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = millis();
  }
}
