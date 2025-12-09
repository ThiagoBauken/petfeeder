/*
 * ═══════════════════════════════════════════════════════════════════
 * PetFeeder ESP32 - VERSÃO OFFLINE + DEEP SLEEP
 * ═══════════════════════════════════════════════════════════════════
 *
 * FUNCIONALIDADES:
 * ✅ Configura horários pelo site
 * ✅ Salva horários na memória flash (funciona SEM internet)
 * ✅ Deep Sleep para economia de energia
 * ✅ Acorda automaticamente nos horários de alimentação
 * ✅ Sincroniza com servidor a cada 6 horas
 * ✅ Funciona 100% offline após configurado
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
//                    🔧 CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════

const char* SERVER_URL = "https://telegram-petfeeder.pbzgje.easypanel.host";
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET = -3 * 3600;  // Brasil (GMT-3)

// Intervalo para buscar atualizações (em horas)
#define SYNC_INTERVAL_HOURS 6

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

// Máximo de 10 horários
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
  bool configured;
  Schedule schedules[MAX_SCHEDULES];
  uint8_t scheduleCount;
  uint32_t lastSync;  // Timestamp da última sincronização
};

// ══════════════════════════════════════════════════════════════════
//                    VARIÁVEIS GLOBAIS
// ══════════════════════════════════════════════════════════════════

Config config;
Preferences preferences;
WebServer server(80);
WiFiClientSecure httpsClient;

String DEVICE_ID = "";
int currentStep = 0;
float foodLevel = 0;
bool isAPMode = false;

// Motivo do wakeup
RTC_DATA_ATTR int bootCount = 0;
RTC_DATA_ATTR bool scheduledWakeup = false;

// ══════════════════════════════════════════════════════════════════
//                    SETUP
// ══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  bootCount++;

  // Gera Device ID
  uint8_t mac[6];
  WiFi.macAddress(mac);
  DEVICE_ID = String(mac[3], HEX) + String(mac[4], HEX) + String(mac[5], HEX);
  DEVICE_ID.toUpperCase();

  Serial.println("\n");
  Serial.println("╔═══════════════════════════════════════════════════════════╗");
  Serial.println("║      PetFeeder ESP32 - OFFLINE + DEEP SLEEP               ║");
  Serial.println("╚═══════════════════════════════════════════════════════════╝");
  Serial.printf("📱 Device ID: %s\n", DEVICE_ID.c_str());
  Serial.printf("🔄 Boot #%d\n", bootCount);

  // Configura pinos
  setupHardware();

  // Carrega configuração da flash
  loadConfig();

  // Verifica motivo do wakeup
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_TIMER:
      Serial.println("⏰ Acordou por TIMER (horário agendado)");
      handleScheduledWakeup();
      break;

    case ESP_SLEEP_WAKEUP_EXT0:
      Serial.println("🔘 Acordou por BOTÃO");
      // Pode adicionar botão físico para alimentar manualmente
      break;

    default:
      Serial.println("🔌 Boot normal (energia ligada)");
      handleNormalBoot();
      break;
  }
}

void loop() {
  // Modo AP - portal de configuração
  if (isAPMode) {
    server.handleClient();
    blinkLED(500);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    HANDLERS DE WAKEUP
// ══════════════════════════════════════════════════════════════════

void handleNormalBoot() {
  if (!config.configured) {
    Serial.println("⚙️ Não configurado. Iniciando portal...");
    startConfigPortal();
    return;
  }

  // Tenta conectar WiFi
  if (connectWiFi(config.wifi_ssid, config.wifi_pass, 15)) {
    Serial.println("✅ WiFi conectado!");

    // Sincroniza horário
    syncTime();

    // Verifica se precisa sincronizar com servidor
    if (needsSync()) {
      syncWithServer();
    }

    // Verifica comandos pendentes
    checkCommands();

    // Envia status
    sendStatus();
  } else {
    Serial.println("⚠️ Sem WiFi - usando horários salvos");
  }

  // Calcula próximo horário e dorme
  scheduleNextWakeup();
}

void handleScheduledWakeup() {
  // Verifica qual horário disparou
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("⚠️ Não conseguiu obter hora. Alimentando dose média...");
    dispense(DOSE_MEDIUM);
    scheduleNextWakeup();
    return;
  }

  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday;  // 0=Dom, 1=Seg, ...

  Serial.printf("🕐 Hora atual: %02d:%02d (dia %d)\n", currentHour, currentMinute, currentDay);

  // Procura o horário que disparou
  for (int i = 0; i < config.scheduleCount; i++) {
    Schedule& s = config.schedules[i];

    if (!s.active) continue;

    // Verifica se é o dia certo
    if (!(s.days & (1 << currentDay))) continue;

    // Verifica se é o horário (com margem de 2 minutos)
    int scheduleMins = s.hour * 60 + s.minute;
    int currentMins = currentHour * 60 + currentMinute;

    if (abs(scheduleMins - currentMins) <= 2) {
      Serial.printf("🍽️ Alimentação agendada: %02d:%02d\n", s.hour, s.minute);

      int steps = DOSE_MEDIUM;
      if (s.doseType == 1) steps = DOSE_SMALL;
      else if (s.doseType == 3) steps = DOSE_LARGE;

      dispense(steps);

      // Tenta enviar log ao servidor
      if (connectWiFi(config.wifi_ssid, config.wifi_pass, 10)) {
        sendFeedingLog(s.doseType == 1 ? "small" : (s.doseType == 3 ? "large" : "medium"), steps);
        sendStatus();
      }

      break;
    }
  }

  // Agenda próximo wakeup
  scheduleNextWakeup();
}

// ══════════════════════════════════════════════════════════════════
//                    SINCRONIZAÇÃO COM SERVIDOR
// ══════════════════════════════════════════════════════════════════

bool needsSync() {
  uint32_t now = time(nullptr);
  uint32_t hoursSinceSync = (now - config.lastSync) / 3600;
  return hoursSinceSync >= SYNC_INTERVAL_HOURS;
}

void syncWithServer() {
  Serial.println("📡 Sincronizando com servidor...");

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/schedules";

  http.begin(httpsClient, url);
  int code = http.GET();

  if (code == 200) {
    String response = http.getString();
    parseSchedules(response);
    config.lastSync = time(nullptr);
    saveConfig();
    Serial.println("✅ Horários atualizados!");
  } else {
    Serial.printf("⚠️ Erro ao sincronizar: %d\n", code);
  }

  http.end();
}

void parseSchedules(String json) {
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, json);

  if (error) {
    Serial.println("❌ Erro ao parsear JSON");
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
    Serial.printf("   Horário %d: %02d:%02d dose=%d dias=0x%02X\n",
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

        Serial.println("📡 Comando remoto: ALIMENTAR " + size);
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
    // Sem hora válida, acorda em 1 hora
    Serial.println("⚠️ Sem hora. Dormindo por 1 hora...");
    goToSleep(3600);
    return;
  }

  int currentMins = timeinfo.tm_hour * 60 + timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday;
  int minSleepMins = 24 * 60;  // Máximo 24 horas
  bool foundSchedule = false;

  // Procura próximo horário
  for (int dayOffset = 0; dayOffset < 7; dayOffset++) {
    int checkDay = (currentDay + dayOffset) % 7;

    for (int i = 0; i < config.scheduleCount; i++) {
      Schedule& s = config.schedules[i];

      if (!s.active) continue;
      if (!(s.days & (1 << checkDay))) continue;

      int scheduleMins = s.hour * 60 + s.minute;

      // Se é hoje, só considera horários futuros
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

    if (foundSchedule && dayOffset == 0) break;  // Encontrou hoje
  }

  if (foundSchedule) {
    // Adiciona tempo para sincronização periódica
    int syncMins = SYNC_INTERVAL_HOURS * 60;
    if (minSleepMins > syncMins) {
      minSleepMins = syncMins;
      Serial.printf("📡 Próxima sync em %d minutos\n", minSleepMins);
    } else {
      Serial.printf("⏰ Próxima alimentação em %d minutos\n", minSleepMins);
    }
  } else {
    // Sem horários, acorda para sincronizar
    minSleepMins = SYNC_INTERVAL_HOURS * 60;
    Serial.printf("📡 Sem horários. Sync em %d minutos\n", minSleepMins);
  }

  goToSleep(minSleepMins * 60);
}

void goToSleep(uint32_t seconds) {
  Serial.printf("😴 Entrando em Deep Sleep por %d segundos...\n\n", seconds);

  // Desliga WiFi
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // Desliga motor
  stopMotor();

  // Configura timer
  esp_sleep_enable_timer_wakeup(seconds * 1000000ULL);

  // Vai dormir
  esp_deep_sleep_start();
}

// ══════════════════════════════════════════════════════════════════
//                    MOTOR
// ══════════════════════════════════════════════════════════════════

void dispense(int steps) {
  Serial.printf("🔄 Dispensando %d passos...\n", steps);
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
  Serial.println("✅ Alimentação concluída!");
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

  Serial.printf("📏 Nível: %.0f%% (%.1fcm)\n", foodLevel, distanceCm);
}

// ══════════════════════════════════════════════════════════════════
//                    WIFI & TIME
// ══════════════════════════════════════════════════════════════════

bool connectWiFi(const char* ssid, const char* pass, int timeoutSec) {
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
    Serial.printf("🕐 Hora: %02d:%02d:%02d\n",
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    SERVIDOR HTTP
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
//                    PORTAL DE CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════

void startConfigPortal() {
  isAPMode = true;

  String apName = "PetFeeder_" + DEVICE_ID;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str(), "12345678");

  Serial.println("\n════════════════════════════════════════");
  Serial.println("📡 PORTAL DE CONFIGURAÇÃO");
  Serial.println("════════════════════════════════════════");
  Serial.println("WiFi: " + apName);
  Serial.println("Senha: 12345678");
  Serial.println("URL: http://192.168.4.1");
  Serial.println("════════════════════════════════════════\n");

  setupWebRoutes();
  server.begin();
}

void setupWebRoutes() {
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
    h1{color:#333;text-align:center}
    .sub{color:#666;text-align:center;margin-bottom:20px}
    input{width:100%;padding:15px;margin:10px 0;border:2px solid #ddd;border-radius:10px;font-size:16px}
    button{width:100%;padding:15px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;font-size:18px;cursor:pointer;margin-top:20px}
    .icon{font-size:60px;text-align:center}
    .info{background:#f5f5f5;padding:15px;border-radius:10px;margin-top:20px;font-size:14px;color:#666}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🐕</div>
    <h1>PetFeeder</h1>
    <p class="sub">Configure seu alimentador</p>
    <form action="/save" method="POST">
      <input type="text" name="ssid" placeholder="Nome da rede WiFi" required>
      <input type="password" name="pass" placeholder="Senha do WiFi" required>
      <button type="submit">💾 Salvar e Conectar</button>
    </form>
    <div class="info">
      <p>📱 Device: )" + DEVICE_ID + R"(</p>
      <p>🌐 Servidor: )" + String(SERVER_URL) + R"(</p>
      <p>💡 Após configurar, o dispositivo vai sincronizar os horários automaticamente com o site.</p>
    </div>
  </div>
</body>
</html>
)";
    server.send(200, "text/html", html);
  });

  server.on("/save", HTTP_POST, []() {
    String ssid = server.arg("ssid");
    String pass = server.arg("pass");

    ssid.toCharArray(config.wifi_ssid, 32);
    pass.toCharArray(config.wifi_pass, 64);
    config.configured = true;
    saveConfig();

    String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;font-family:Arial;display:flex;align-items:center;justify-content:center}
    .card{background:#fff;border-radius:20px;padding:40px;text-align:center}
    .icon{font-size:80px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Configurado!</h1>
    <p>O dispositivo vai reiniciar e sincronizar os horários.</p>
    <p>Configure os horários no dashboard do site!</p>
  </div>
</body>
</html>
)";
    server.send(200, "text/html", html);
    delay(2000);
    ESP.restart();
  });

  // Alimentar manualmente
  server.on("/feed", HTTP_GET, []() {
    String size = server.arg("size");
    int steps = DOSE_MEDIUM;
    if (size == "small") steps = DOSE_SMALL;
    else if (size == "large") steps = DOSE_LARGE;

    dispense(steps);
    server.send(200, "application/json", "{\"success\":true}");
  });
}

// ══════════════════════════════════════════════════════════════════
//                    CONFIG (FLASH)
// ══════════════════════════════════════════════════════════════════

void loadConfig() {
  preferences.begin("petfeeder", true);

  preferences.getString("ssid", config.wifi_ssid, 32);
  preferences.getString("pass", config.wifi_pass, 64);
  config.configured = preferences.getBool("configured", false);
  config.scheduleCount = preferences.getUChar("schCount", 0);
  config.lastSync = preferences.getUInt("lastSync", 0);

  // Carrega schedules
  for (int i = 0; i < config.scheduleCount && i < MAX_SCHEDULES; i++) {
    String key = "sch" + String(i);
    size_t len = preferences.getBytes(key.c_str(), &config.schedules[i], sizeof(Schedule));
  }

  preferences.end();

  Serial.printf("📂 Config: %d horários salvos\n", config.scheduleCount);
}

void saveConfig() {
  preferences.begin("petfeeder", false);

  preferences.putString("ssid", config.wifi_ssid);
  preferences.putString("pass", config.wifi_pass);
  preferences.putBool("configured", config.configured);
  preferences.putUChar("schCount", config.scheduleCount);
  preferences.putUInt("lastSync", config.lastSync);

  // Salva schedules
  for (int i = 0; i < config.scheduleCount && i < MAX_SCHEDULES; i++) {
    String key = "sch" + String(i);
    preferences.putBytes(key.c_str(), &config.schedules[i], sizeof(Schedule));
  }

  preferences.end();
  Serial.println("💾 Config salva na flash!");
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
