/*
 * PETFEEDER ESP32 - WIFI SETUP + MODO ECONOMIA CONTROLAVEL
 *
 * FUNCIONALIDADES:
 * - Configura WiFi + Email pelo celular (captive portal)
 * - Auto-registra no servidor usando email
 * - SEM horarios = fica acordado (polling 30s)
 * - COM horarios + Economia ON = ativa Deep Sleep economico
 * - COM horarios + Economia OFF = fica acordado (recebe comandos instantaneos)
 * - Funciona offline apos configurado
 * - Toggle de Modo Economia controlavel pelo site!
 *
 * FLUXO:
 * 1. Liga -> Cria rede "PetFeeder-Setup" (senha: 12345678)
 * 2. Configura WiFi + Email
 * 3. Registra automaticamente na conta
 * 4. Aguarda configuracao de horarios no site
 * 5. Quando tiver horarios:
 *    - Se Modo Economia ATIVADO -> Deep Sleep (economiza bateria)
 *    - Se Modo Economia DESATIVADO -> Fica acordado (comandos instantaneos)
 *
 * PINOS:
 * Motor: GPIO 16, 17, 18, 19 (28BYJ-48)
 * Sensor: TRIG=26, ECHO=25 (HC-SR04)
 * LED: GPIO 2
 * Botao Reset: GPIO 0 (BOOT)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_sleep.h>

// ==================== CONFIGURACOES ====================

const char* AP_SSID = "PetFeeder-Setup";
const char* AP_PASS = "12345678";
String serverUrl = "https://telegram-petfeeder.pbzgje.easypanel.host";

// Pinos do Motor 28BYJ-48
#define MOTOR_IN1 16
#define MOTOR_IN2 17
#define MOTOR_IN3 18
#define MOTOR_IN4 19

// Pinos do Sensor HC-SR04
#define TRIG_PIN 26
#define ECHO_PIN 25

// LED e Botao
#define LED_PIN 2
#define RESET_PIN 0

// Intervalos
#define POLL_INTERVAL_MS 30000           // 30s quando aguardando config
#define COMMAND_POLL_INTERVAL_MS 5000    // 5s para verificar comandos no modo ativo
#define SYNC_INTERVAL_HOURS 6            // Sync a cada 6h
#define STATUS_INTERVAL_MS 300000        // Status a cada 5min

// Motor (valores triplicados)
const int DOSE_SMALL = 6144;     // 2048 * 3
const int DOSE_MEDIUM = 12288;   // 4096 * 3
const int DOSE_LARGE = 18432;    // 6144 * 3

const int stepSequence[8][4] = {
  {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0},
  {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}
};

// ==================== VARIAVEIS GLOBAIS ====================

Preferences preferences;
WebServer webServer(80);
DNSServer dnsServer;
WiFiClientSecure httpsClient;

String savedSSID = "";
String savedPassword = "";
String deviceId = "";
String userEmail = "";

bool configMode = false;
bool wifiConnected = false;
bool waitingForSchedules = false;  // Aguardando config de horarios
bool powerSaveEnabled = false;     // Modo economia DESATIVADO por padrao (fica acordado)
bool activeMode = false;           // Modo ativo (polling continuo)
int currentStep = 0;

// Contadores RTC (sobrevivem ao Deep Sleep)
RTC_DATA_ATTR int bootCount = 0;
RTC_DATA_ATTR bool deviceRegistered = false;

struct Schedule {
  int hour;
  int minute;
  int doseSize;
  bool active;
  uint8_t days;  // Bitmask: bit0=Dom, bit1=Seg, ..., bit6=Sab
};
Schedule schedules[10];
int scheduleCount = 0;

unsigned long lastPollTime = 0;
unsigned long lastStatusTime = 0;

// ==================== PROTOTIPOS ====================

void handleTimerWakeup();
void handleNormalBoot();
void startConfigMode();
void startWaitingMode();
void scheduleNextWakeup();
void goToSleep(uint32_t seconds);
void checkScheduledFeeding();
bool fetchSchedules();
void sendStatus();
void registerDevice();
void checkCommands();
void sendFeedingLog(int doseSize);
void dispense(int doseSize);
float readFoodLevel();
void handleRoot();
void handleScan();
void handleSave();
void handleFeed();
void handleLocalStatus();
void checkResetButton();
void loadConfig();
void saveConfig(String ssid, String password, String email);
void saveSchedulesToFlash();
void clearConfig();
bool connectWiFi();
void setStep(int a, int b, int c, int d);
void stopMotor();
void setupPins();

// ==================== DEVICE ID ====================

String getDeviceId() {
  uint64_t chipId = ESP.getEfuseMac();
  char id[18];
  sprintf(id, "PF_%02X%02X%02X",
    (uint8_t)(chipId >> 24),
    (uint8_t)(chipId >> 32),
    (uint8_t)(chipId >> 40));
  return String(id);
}

// ==================== FUNCOES DO MOTOR ====================

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
  digitalWrite(LED_PIN, LOW);
}

void dispense(int doseSize) {
  int steps;
  switch (doseSize) {
    case 1: steps = DOSE_SMALL; break;
    case 3: steps = DOSE_LARGE; break;
    default: steps = DOSE_MEDIUM; break;
  }

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
  Serial.println("[OK] Alimentacao concluida!");
  delay(500);
}

// ==================== SENSOR ====================
// Suporta HC-SR04 (4 pinos) e sensores de 3 pinos (S/V/G)
// Para 3 pinos: conecte S no GPIO 25, use mesmo pino para TRIG e ECHO

// Se seu sensor tem 3 pinos, descomente a linha abaixo:
// #define SENSOR_3_PINOS

float readFoodLevel() {
  long duration = 0;

#ifdef SENSOR_3_PINOS
  // Sensor de 3 pinos: mesmo pino para TRIG e ECHO
  pinMode(ECHO_PIN, OUTPUT);
  digitalWrite(ECHO_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ECHO_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ECHO_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  duration = pulseIn(ECHO_PIN, HIGH, 50000);
#else
  // HC-SR04 padrão (4 pinos)
  // NÃO usar noInterrupts() pois conflita com WiFi do ESP32
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Timeout de 50ms (max ~8.5m)
  duration = pulseIn(ECHO_PIN, HIGH, 50000);
#endif

  // Debug do sensor
  Serial.printf("[SENSOR] duration=%ld us", duration);

  if (duration == 0) {
    Serial.println(" -> TIMEOUT (sem resposta)");
    Serial.println("         Verifique: VCC=5V, GND, TRIG=GPIO26, ECHO=GPIO25");
    Serial.println("         Se sensor 3 pinos: descomente #define SENSOR_3_PINOS no codigo");
    return -1;
  }

  float distance = duration * 0.034 / 2;  // cm
  Serial.printf(" -> distancia=%.1f cm", distance);

  float level;
  if (distance < 5) {
    level = 100;
  } else if (distance > 20) {
    level = 0;
  } else {
    level = map((long)distance, 20, 5, 0, 100);
  }

  Serial.printf(" -> nivel=%d%%\n", (int)level);
  return level;
}

// ==================== CONFIGURACAO PERSISTENTE ====================

void loadConfig() {
  preferences.begin("petfeeder", false);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("password", "");
  deviceId = getDeviceId();
  userEmail = preferences.getString("email", "");
  scheduleCount = preferences.getInt("schedCount", 0);

  // Carrega horarios da flash
  for (int i = 0; i < scheduleCount && i < 10; i++) {
    String key = "s" + String(i);
    schedules[i].hour = preferences.getInt((key + "h").c_str(), 0);
    schedules[i].minute = preferences.getInt((key + "m").c_str(), 0);
    schedules[i].doseSize = preferences.getInt((key + "d").c_str(), 2);
    schedules[i].active = preferences.getBool((key + "a").c_str(), true);
    schedules[i].days = preferences.getUChar((key + "w").c_str(), 0x7F);  // Todos os dias
  }

  Serial.println("\n[CONFIG] Carregado:");
  Serial.printf("  SSID: %s\n", savedSSID.length() > 0 ? savedSSID.c_str() : "(vazio)");
  Serial.printf("  Email: %s\n", userEmail.length() > 0 ? userEmail.c_str() : "(vazio)");
  Serial.printf("  Device: %s\n", deviceId.c_str());
  Serial.printf("  Horarios: %d\n", scheduleCount);
}

void saveConfig(String ssid, String password, String email) {
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.putString("email", email);
  savedSSID = ssid;
  savedPassword = password;
  userEmail = email;
  deviceId = getDeviceId();
  deviceRegistered = false;  // Precisa registrar novamente
  Serial.println("[CONFIG] Salvo!");
}

void saveSchedulesToFlash() {
  preferences.putInt("schedCount", scheduleCount);
  for (int i = 0; i < scheduleCount && i < 10; i++) {
    String key = "s" + String(i);
    preferences.putInt((key + "h").c_str(), schedules[i].hour);
    preferences.putInt((key + "m").c_str(), schedules[i].minute);
    preferences.putInt((key + "d").c_str(), schedules[i].doseSize);
    preferences.putBool((key + "a").c_str(), schedules[i].active);
    preferences.putUChar((key + "w").c_str(), schedules[i].days);
  }
  Serial.printf("[CONFIG] %d horarios salvos na flash\n", scheduleCount);
}

void clearConfig() {
  preferences.clear();
  savedSSID = "";
  savedPassword = "";
  userEmail = "";
  scheduleCount = 0;
  deviceRegistered = false;
  Serial.println("[CONFIG] Limpo!");
}

// ==================== COMUNICACAO COM SERVIDOR ====================

void registerDevice() {
  if (userEmail.length() == 0 || deviceRegistered) return;

  Serial.println("[REGISTRO] Registrando dispositivo...");

  HTTPClient http;
  String url = serverUrl + "/api/devices/auto-register";
  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<256> doc;
  doc["deviceId"] = deviceId;
  doc["email"] = userEmail;
  doc["name"] = "PetFeeder " + deviceId.substring(3);

  String json;
  serializeJson(doc, json);

  int httpCode = http.POST(json);

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("[OK] Dispositivo registrado!");
    deviceRegistered = true;
  } else {
    String response = http.getString();
    Serial.printf("[ERRO] Registro falhou: %d - %s\n", httpCode, response.c_str());
  }

  http.end();
}

// Retorna o modo atual do ESP32
String getCurrentMode() {
  if (configMode) return "config";
  if (waitingForSchedules) return "waiting";
  if (activeMode) return "active";
  return "sleep";  // Vai dormir
}

void sendStatus() {
  if (!wifiConnected || deviceId.length() == 0) return;

  float foodLevel = readFoodLevel();
  if (foodLevel < 0) foodLevel = 0;

  HTTPClient http;
  String url = serverUrl + "/api/devices/" + deviceId + "/status";
  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<512> doc;
  doc["food_level"] = (int)foodLevel;
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  doc["schedules_count"] = scheduleCount;
  doc["waiting_config"] = waitingForSchedules;
  doc["boot_count"] = bootCount;
  doc["mode"] = getCurrentMode();
  doc["power_save_enabled"] = powerSaveEnabled;

  String json;
  serializeJson(doc, json);

  int httpCode = http.POST(json);

  if (httpCode == 200) {
    Serial.printf("[STATUS] Enviado: %d%%\n", (int)foodLevel);
  } else {
    Serial.printf("[ERRO] Status: %d\n", httpCode);
  }

  http.end();

  if (foodLevel < 20) {
    Serial.println("[ALERTA] Nivel de comida baixo!");
  }
}

void sendFeedingLog(int doseSize) {
  if (!wifiConnected || deviceId.length() == 0) return;

  HTTPClient http;
  String url = serverUrl + "/api/feed/log";
  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  String size = doseSize == 1 ? "small" : doseSize == 3 ? "large" : "medium";

  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["size"] = size;
  doc["trigger"] = "scheduled";
  doc["food_level_after"] = (int)readFoodLevel();

  String json;
  serializeJson(doc, json);

  int httpCode = http.POST(json);
  if (httpCode == 200) {
    Serial.println("[LOG] Alimentacao registrada");
  }
  http.end();
}

bool fetchSchedules() {
  if (!wifiConnected || deviceId.length() == 0) return false;

  Serial.println("[SYNC] Buscando horarios...");

  HTTPClient http;
  String url = serverUrl + "/api/devices/" + deviceId + "/schedules";
  http.begin(httpsClient, url);
  http.setTimeout(10000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("[SYNC] Resposta: %s\n", payload.c_str());

    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
      Serial.printf("[ERRO] JSON parse: %s\n", error.c_str());
    }

    if (!error && doc["success"]) {
      JsonArray data = doc["data"];
      scheduleCount = 0;

      // Ler configuracao de power_save do servidor
      if (doc.containsKey("power_save")) {
        powerSaveEnabled = doc["power_save"].as<bool>();
        Serial.printf("[CONFIG] power_save recebido do servidor: %s\n", powerSaveEnabled ? "true" : "false");
        Serial.printf("[CONFIG] Modo Economia: %s\n", powerSaveEnabled ? "ATIVADO (Deep Sleep)" : "DESATIVADO (Polling ativo)");
      } else {
        Serial.println("[AVISO] Servidor nao enviou power_save, mantendo default: ATIVADO");
      }

      for (JsonObject item : data) {
        if (scheduleCount >= 10) break;

        schedules[scheduleCount].hour = item["hour"];
        schedules[scheduleCount].minute = item["minute"];

        String size = item["size"] | "medium";
        if (size == "small") schedules[scheduleCount].doseSize = 1;
        else if (size == "large") schedules[scheduleCount].doseSize = 3;
        else schedules[scheduleCount].doseSize = 2;

        schedules[scheduleCount].active = item["active"] | true;

        // Parse dias
        schedules[scheduleCount].days = 0x7F;  // Default: todos os dias
        if (item.containsKey("days")) {
          JsonArray daysArr = item["days"];
          schedules[scheduleCount].days = 0;
          for (int d : daysArr) {
            schedules[scheduleCount].days |= (1 << d);
          }
        }

        Serial.printf("  [%d] %02d:%02d dose=%d dias=0x%02X\n",
          scheduleCount + 1,
          schedules[scheduleCount].hour,
          schedules[scheduleCount].minute,
          schedules[scheduleCount].doseSize,
          schedules[scheduleCount].days);

        scheduleCount++;
      }

      Serial.printf("[OK] %d horarios sincronizados\n", scheduleCount);
      saveSchedulesToFlash();
      http.end();
      return true;
    }
  } else {
    Serial.printf("[ERRO] Sync: %d\n", httpCode);
  }

  http.end();
  return false;
}

void checkCommands() {
  if (!wifiConnected || deviceId.length() == 0) {
    Serial.println("[COMMANDS] Sem WiFi ou deviceId");
    return;
  }

  HTTPClient http;
  String url = serverUrl + "/api/devices/" + deviceId + "/commands";
  Serial.printf("[COMMANDS] GET %s\n", url.c_str());
  http.begin(httpsClient, url);
  http.setTimeout(5000);

  int httpCode = http.GET();
  Serial.printf("[COMMANDS] HTTP %d\n", httpCode);

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("[COMMANDS] Resposta: %s\n", payload.c_str());
    StaticJsonDocument<256> doc;

    if (!deserializeJson(doc, payload) && doc.containsKey("command")) {
      String cmd = doc["command"].as<String>();

      if (cmd == "feed") {
        String size = doc["size"] | "medium";
        int doseSize = size == "small" ? 1 : size == "large" ? 3 : 2;
        Serial.printf("[COMANDO] Alimentar: %s\n", size.c_str());
        dispense(doseSize);
        sendFeedingLog(doseSize);
        sendStatus();
      } else if (cmd == "sync") {
        Serial.println("[COMANDO] Sync");
        fetchSchedules();
      }
    } else {
      Serial.println("[COMMANDS] Nenhum comando pendente");
    }
  } else {
    Serial.printf("[COMMANDS] ERRO HTTP: %d\n", httpCode);
  }

  http.end();
}

// ==================== DEEP SLEEP ====================

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

    for (int i = 0; i < scheduleCount; i++) {
      if (!schedules[i].active) continue;
      if (!(schedules[i].days & (1 << checkDay))) continue;

      int scheduleMins = schedules[i].hour * 60 + schedules[i].minute;

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

// ==================== VERIFICACAO DE HORARIOS ====================

void checkScheduledFeeding() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;
  int currentDay = timeinfo.tm_wday;

  for (int i = 0; i < scheduleCount; i++) {
    if (!schedules[i].active) continue;
    if (!(schedules[i].days & (1 << currentDay))) continue;

    int scheduleMins = schedules[i].hour * 60 + schedules[i].minute;
    int currentMins = currentHour * 60 + currentMinute;

    if (abs(scheduleMins - currentMins) <= 2) {
      Serial.printf("[ALIMENTAR] Horario %02d:%02d\n", schedules[i].hour, schedules[i].minute);
      dispense(schedules[i].doseSize);
      sendFeedingLog(schedules[i].doseSize);
      sendStatus();
      return;
    }
  }
}

// ==================== WIFI ====================

bool connectWiFi() {
  Serial.printf("[WIFI] Conectando a %s", savedSSID.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (wifiConnected) {
    httpsClient.setInsecure();
    Serial.printf("[OK] IP: %s\n", WiFi.localIP().toString().c_str());
  }
  return wifiConnected;
}

// ==================== CAPTIVE PORTAL ====================

void handleRoot() {
  String devId = getDeviceId();
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PetFeeder Setup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;padding:20px}
    .container{max-width:400px;margin:0 auto;background:#fff;border-radius:20px;padding:30px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
    h1{text-align:center;color:#333;margin-bottom:10px}
    .subtitle{text-align:center;color:#666;margin-bottom:20px}
    .icon{text-align:center;font-size:60px;margin-bottom:20px}
    label{display:block;margin-bottom:5px;color:#333;font-weight:500}
    input{width:100%;padding:15px;margin-bottom:20px;border:2px solid #eee;border-radius:10px;font-size:16px}
    input:focus{border-color:#667eea;outline:none}
    button{width:100%;padding:15px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;font-size:18px;font-weight:bold;cursor:pointer}
    button:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(102,126,234,.4)}
    .scan-btn{background:#4CAF50;margin-bottom:15px}
    .networks{margin-bottom:20px}
    .network{padding:12px;background:#f5f5f5;border-radius:8px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between}
    .network:hover{background:#e0e0e0}
    .loading{text-align:center;padding:20px}
    .spinner{border:3px solid #f3f3f3;border-top:3px solid #667eea;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite;margin:0 auto 10px}
    @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    .success{background:#4CAF50;color:#fff;padding:20px;border-radius:10px;text-align:center}
    .device-id-box{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:20px;border-radius:15px;text-align:center;margin-bottom:25px}
    .device-id-box h3{margin-bottom:5px;font-size:14px;opacity:0.9}
    .device-id-box .id{font-size:28px;font-weight:bold;font-family:monospace;letter-spacing:2px}
    .device-id-box p{font-size:12px;margin-top:10px;opacity:0.8}
    .info{background:#e3f2fd;padding:15px;border-radius:10px;margin-top:20px;font-size:13px;color:#1565c0}
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128054;</div>
    <h1>PetFeeder Setup</h1>
    <p class="subtitle">Configure seu alimentador</p>

    <div class="device-id-box">
      <h3>ID DO DISPOSITIVO</h3>
      <div class="id">)rawliteral" + devId + R"rawliteral(</div>
      <p>Sera vinculado automaticamente a sua conta</p>
    </div>

    <div id="form">
      <form id="configForm" onsubmit="saveConfig(event)">
        <label>Email da sua conta PetFeeder *</label>
        <input type="email" id="email" placeholder="seu@email.com" required>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <button type="button" class="scan-btn" onclick="scanNetworks()">Buscar Redes WiFi</button>
        <div id="networks" class="networks"></div>
        <label>Rede WiFi *</label>
        <input type="text" id="ssid" placeholder="Selecione acima ou digite" required>
        <label>Senha WiFi *</label>
        <input type="password" id="password" placeholder="Senha da rede" required>
        <button type="submit">Conectar e Vincular</button>
      </form>
    </div>
    <div id="loading" class="loading" style="display:none">
      <div class="spinner"></div>
      <p>Conectando...</p>
    </div>
    <div id="success" class="success" style="display:none">
      <h2>Configurado!</h2>
      <p>O ESP32 vai reiniciar e vincular automaticamente na sua conta.</p>
    </div>
    <div class="info">
      <strong>Proximo passo:</strong> Acesse o site, faca login e configure os horarios de alimentacao.
      O modo economia de energia sera ativado automaticamente!
    </div>
  </div>
  <script>
    function scanNetworks(){
      document.getElementById('networks').innerHTML='<div class="loading"><div class="spinner"></div><p>Buscando...</p></div>';
      fetch('/scan').then(r=>r.json()).then(data=>{
        let html='';
        data.networks.forEach(n=>{html+='<div class="network" onclick="selectNetwork(\''+n.ssid+'\')"><span>'+n.ssid+'</span><span>'+n.rssi+' dBm</span></div>';});
        document.getElementById('networks').innerHTML=html||'<p>Nenhuma rede encontrada</p>';
      }).catch(e=>{document.getElementById('networks').innerHTML='<p>Erro ao buscar</p>';});
    }
    function selectNetwork(ssid){document.getElementById('ssid').value=ssid;document.getElementById('password').focus();}
    function saveConfig(e){
      e.preventDefault();
      document.getElementById('form').style.display='none';
      document.getElementById('loading').style.display='block';
      const data=new URLSearchParams();
      data.append('ssid',document.getElementById('ssid').value);
      data.append('password',document.getElementById('password').value);
      data.append('email',document.getElementById('email').value);
      fetch('/save',{method:'POST',body:data}).then(r=>r.json()).then(data=>{
        document.getElementById('loading').style.display='none';
        document.getElementById('success').style.display='block';
      }).catch(e=>{
        document.getElementById('loading').style.display='none';
        document.getElementById('form').style.display='block';
        alert('Erro ao salvar.');
      });
    }
  </script>
</body>
</html>
)rawliteral";
  webServer.send(200, "text/html", html);
}

void handleScan() {
  Serial.println("[SCAN] Buscando redes...");
  int n = WiFi.scanNetworks();
  String json = "{\"networks\":[";
  for (int i = 0; i < n && i < 10; i++) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]}";
  webServer.send(200, "application/json", json);
}

void handleSave() {
  String ssid = webServer.arg("ssid");
  String password = webServer.arg("password");
  String email = webServer.arg("email");

  Serial.println("\n[SAVE] Configurando...");
  Serial.printf("  SSID: %s\n", ssid.c_str());
  Serial.printf("  Email: %s\n", email.c_str());

  saveConfig(ssid, password, email);
  webServer.send(200, "application/json", "{\"success\":true}");

  delay(2000);
  ESP.restart();
}

void handleFeed() {
  String size = webServer.arg("size");
  int doseSize = size == "small" ? 1 : size == "large" ? 3 : 2;

  dispense(doseSize);
  if (wifiConnected) {
    sendFeedingLog(doseSize);
    sendStatus();
  }

  webServer.send(200, "application/json", "{\"success\":true}");
}

void handleLocalStatus() {
  StaticJsonDocument<256> doc;
  doc["device_id"] = deviceId;
  doc["food_level"] = (int)readFoodLevel();
  doc["schedules"] = scheduleCount;
  doc["waiting_config"] = waitingForSchedules;

  String json;
  serializeJson(doc, json);
  webServer.send(200, "application/json", json);
}

void startConfigMode() {
  configMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.println("\n========================================");
  Serial.println("    MODO CONFIGURACAO");
  Serial.println("========================================");
  Serial.printf("WiFi: %s\n", AP_SSID);
  Serial.printf("Senha: %s\n", AP_PASS);
  Serial.printf("URL: http://%s\n", WiFi.softAPIP().toString().c_str());
  Serial.println("========================================\n");

  dnsServer.start(53, "*", WiFi.softAPIP());

  webServer.on("/", handleRoot);
  webServer.on("/scan", handleScan);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.on("/feed", handleFeed);
  webServer.on("/status", handleLocalStatus);
  webServer.onNotFound(handleRoot);

  webServer.begin();
}

// Modo ativo: com horarios mas SEM Deep Sleep (power_save = false)
unsigned long lastScheduleCheck = 0;
#define SCHEDULE_CHECK_INTERVAL_MS 60000  // Verificar horarios a cada 1 min

void startActiveMode() {
  activeMode = true;
  waitingForSchedules = false;
  lastPollTime = millis();  // Resetar para começar polling imediatamente
  lastScheduleCheck = millis();
  Serial.println("\n========================================");
  Serial.println("    MODO ATIVO (SEM DEEP SLEEP)");
  Serial.println("========================================");
  Serial.println("Modo economia DESATIVADO pelo site");
  Serial.printf("IP local: http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("Verificando comandos a cada 30s");
  Serial.println("Verificando horarios a cada 1min");
  Serial.println("========================================\n");

  // Servidor local
  webServer.on("/", []() {
    float level = readFoodLevel();
    String html = R"rawliteral(
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
    .status{background:#d4edda;padding:15px;border-radius:10px;margin:20px 0;text-align:center;color:#155724}
    .btn{display:block;width:100%;padding:15px;margin:10px 0;border:none;border-radius:10px;font-size:16px;cursor:pointer;color:#fff}
    .btn-med{background:#4CAF50}
    .btn-sm{background:#8BC34A}
    .btn-lg{background:#FF9800}
    .info{font-size:13px;color:#666;text-align:center;margin-top:20px}
  </style>
</head>
<body>
  <div class="card">
    <h1>PetFeeder )rawliteral" + deviceId + R"rawliteral(</h1>
    <div class="status">
      <strong>Modo Ativo</strong><br>
      )rawliteral" + String(scheduleCount) + R"rawliteral( horarios configurados
    </div>
    <button class="btn btn-med" onclick="feed('medium')">Alimentar (Media)</button>
    <button class="btn btn-sm" onclick="feed('small')">Porcao Pequena</button>
    <button class="btn btn-lg" onclick="feed('large')">Porcao Grande</button>
    <p class="info">Nivel: )rawliteral" + String((int)level) + R"rawliteral(%</p>
  </div>
  <script>
  function feed(s){fetch('/feed?size='+s).then(function(r){return r.json();}).then(function(d){alert('Alimentando!');}).catch(function(e){alert('Erro');});}
  </script>
</body>
</html>
)rawliteral";
    webServer.send(200, "text/html", html);
  });

  webServer.on("/feed", handleFeed);
  webServer.on("/status", handleLocalStatus);
  webServer.begin();
}

void startWaitingMode() {
  waitingForSchedules = true;
  activeMode = false;
  Serial.println("\n========================================");
  Serial.println("    AGUARDANDO CONFIGURACAO");
  Serial.println("========================================");
  Serial.println("Configure os horarios pelo site!");
  Serial.printf("IP local: http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("========================================\n");

  // Servidor local para alimentar manualmente
  webServer.on("/", []() {
    float level = readFoodLevel();
    String html = R"rawliteral(
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
    .btn{display:block;width:100%;padding:15px;margin:10px 0;border:none;border-radius:10px;font-size:16px;cursor:pointer;color:#fff}
    .btn-med{background:#4CAF50}
    .btn-sm{background:#8BC34A}
    .btn-lg{background:#FF9800}
    .info{font-size:13px;color:#666;text-align:center;margin-top:20px}
  </style>
</head>
<body>
  <div class="card">
    <h1>PetFeeder )rawliteral" + deviceId + R"rawliteral(</h1>
    <div class="status">
      <strong>Aguardando configuracao</strong><br>
      Configure os horarios pelo site
    </div>
    <button class="btn btn-med" onclick="feed('medium')">Alimentar (Media)</button>
    <button class="btn btn-sm" onclick="feed('small')">Porcao Pequena</button>
    <button class="btn btn-lg" onclick="feed('large')">Porcao Grande</button>
    <p class="info">Nivel: )rawliteral" + String((int)level) + R"rawliteral(%</p>
  </div>
  <script>
  function feed(s){fetch('/feed?size='+s).then(function(r){return r.json();}).then(function(d){alert('Alimentando!');}).catch(function(e){alert('Erro');});}
  </script>
</body>
</html>
)rawliteral";
    webServer.send(200, "text/html", html);
  });

  webServer.on("/feed", handleFeed);
  webServer.on("/status", handleLocalStatus);
  webServer.begin();
}

// ==================== BOTAO RESET ====================

void checkResetButton() {
  if (digitalRead(RESET_PIN) == LOW) {
    Serial.println("[BOTAO] Detectado...");
    unsigned long start = millis();

    while (digitalRead(RESET_PIN) == LOW) {
      if (millis() - start > 3000) {
        Serial.println("[RESET] Limpando configuracoes...");
        clearConfig();

        for (int i = 0; i < 10; i++) {
          digitalWrite(LED_PIN, !digitalRead(LED_PIN));
          delay(100);
        }

        ESP.restart();
      }
      delay(100);
    }
  }
}

// ==================== SETUP ====================

void setupPins() {
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  stopMotor();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(LED_PIN, OUTPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);

  digitalWrite(LED_PIN, HIGH);
  delay(300);
  digitalWrite(LED_PIN, LOW);
}

void testMotor() {
  Serial.println("\n[TESTE MOTOR]");
  Serial.println("  Girando motor por 0.5 segundo...");
  digitalWrite(LED_PIN, HIGH);

  // Gira apenas 500 passos (teste rapido)
  for (int i = 0; i < 500; i++) {
    setStep(stepSequence[currentStep][0],
            stepSequence[currentStep][1],
            stepSequence[currentStep][2],
            stepSequence[currentStep][3]);
    currentStep = (currentStep + 1) % 8;
    delayMicroseconds(1200);
  }

  stopMotor();
  Serial.println("  Motor OK!\n");
}

void testSensor() {
  Serial.println("\n[TESTE SENSOR HC-SR04]");
  Serial.printf("  TRIG_PIN: GPIO %d\n", TRIG_PIN);
  Serial.printf("  ECHO_PIN: GPIO %d\n", ECHO_PIN);
  Serial.println("  Fazendo 3 leituras...");

  for (int i = 0; i < 3; i++) {
    delay(500);
    Serial.printf("  Leitura %d: ", i + 1);
    float level = readFoodLevel();
    if (level < 0) {
      Serial.println("  >>> SENSOR FALHOU - Verifique conexoes!");
    } else {
      Serial.printf("  >>> OK! Nivel: %.0f%%\n", level);
    }
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  bootCount++;

  Serial.println("\n");
  Serial.println("========================================");
  Serial.println("  PETFEEDER - DEEP SLEEP INTELIGENTE");
  Serial.println("========================================");
  Serial.printf("Boot #%d\n", bootCount);

  setupPins();
  loadConfig();
  checkResetButton();

  // Verifica motivo do wakeup
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();

  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_TIMER:
      Serial.println("[WAKEUP] Timer - alimentacao ou sync");
      handleTimerWakeup();
      return;

    default:
      Serial.println("[BOOT] Normal");
      Serial.println("\n========== TESTES DE HARDWARE ==========");
      testMotor();   // Testa motor no boot
      testSensor();  // Testa sensor no boot
      Serial.println("=========================================\n");
      handleNormalBoot();
      return;
  }
}

void handleTimerWakeup() {
  // Conecta WiFi
  if (!connectWiFi()) {
    Serial.println("[OFFLINE] Usando horarios salvos");
  } else {
    configTime(-3 * 3600, 0, "pool.ntp.org");
    delay(1000);
  }

  // Verifica se e hora de alimentar
  checkScheduledFeeding();

  // Sync se necessario
  if (wifiConnected) {
    static unsigned long lastSync = 0;
    if (bootCount % 12 == 0) {  // Sync a cada ~12 wakeups
      fetchSchedules();
    }
    sendStatus();
    checkCommands();
  }

  // Volta a dormir
  scheduleNextWakeup();
}

void handleNormalBoot() {
  // Nao configurado? Inicia portal
  if (savedSSID.length() == 0) {
    Serial.println("[CONFIG] Nao configurado");
    startConfigMode();
    return;
  }

  // Tenta conectar WiFi
  if (!connectWiFi()) {
    Serial.println("[ERRO] WiFi falhou");
    if (scheduleCount > 0) {
      Serial.println("[OFFLINE] Usando horarios salvos");
      scheduleNextWakeup();
    } else {
      Serial.println("[ERRO] Sem WiFi e sem horarios. Reiniciando portal...");
      clearConfig();
      ESP.restart();
    }
    return;
  }

  // Configura NTP
  configTime(-3 * 3600, 0, "pool.ntp.org");
  delay(1000);

  // Registra dispositivo
  registerDevice();

  // Busca horarios
  fetchSchedules();

  // Envia status
  sendStatus();

  // Verifica comandos
  checkCommands();

  // Log detalhado antes da decisão
  Serial.println("\n========================================");
  Serial.println("    DECISAO DE MODO");
  Serial.println("========================================");
  Serial.printf("scheduleCount: %d\n", scheduleCount);
  Serial.printf("powerSaveEnabled: %s\n", powerSaveEnabled ? "true (Deep Sleep)" : "false (Polling)");

  // Decide: Deep Sleep ou polling continuo
  if (scheduleCount > 0 && powerSaveEnabled) {
    Serial.println("\n>>> DECISAO: Deep Sleep (horarios + economia ON)");
    Serial.println("[SLEEP] Ativando modo economia (Deep Sleep)...");
    scheduleNextWakeup();
  } else if (scheduleCount > 0 && !powerSaveEnabled) {
    Serial.println("\n>>> DECISAO: Modo Ativo (horarios + economia OFF)");
    Serial.println("[ATIVO] Modo economia DESATIVADO - polling continuo");
    startActiveMode();
  } else {
    Serial.println("\n>>> DECISAO: Aguardando (sem horarios)");
    startWaitingMode();
  }
}

// ==================== LOOP ====================

void loop() {
  // Modo configuracao (captive portal)
  if (configMode) {
    dnsServer.processNextRequest();
    webServer.handleClient();

    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 200) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }
    return;
  }

  // Modo aguardando configuracao de horarios
  if (waitingForSchedules) {
    webServer.handleClient();

    // LED pisca devagar
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 1000) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }

    // Polling periodico
    if (millis() - lastPollTime > POLL_INTERVAL_MS) {
      lastPollTime = millis();
      Serial.println("\n[POLL] Verificando horarios...");

      if (fetchSchedules() && scheduleCount > 0) {
        Serial.println("[OK] Horarios encontrados!");
        waitingForSchedules = false;

        // Decide baseado no power_save
        if (powerSaveEnabled) {
          scheduleNextWakeup();
        } else {
          startActiveMode();
        }
        return;
      } else {
        Serial.println("[AGUARDANDO] Configure os horarios pelo site");
      }

      sendStatus();
      checkCommands();
    }
    return;
  }

  // Modo ativo (power_save = false): polling continuo + verifica horarios
  if (activeMode) {
    webServer.handleClient();

    // LED aceso fixo indica modo ativo
    digitalWrite(LED_PIN, HIGH);

    // Debug: mostrar que está no activeMode (a cada 10s)
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug > 10000) {
      lastDebug = millis();
      Serial.printf("[ACTIVE] Loop ativo - millis=%lu, lastPoll=%lu, diff=%lu\n",
                    millis(), lastPollTime, millis() - lastPollTime);
    }

    // Verifica horarios a cada minuto
    if (millis() - lastScheduleCheck > SCHEDULE_CHECK_INTERVAL_MS) {
      lastScheduleCheck = millis();
      checkScheduledFeeding();
    }

    // Polling de comandos a cada 5s para resposta rapida
    if (millis() - lastPollTime > COMMAND_POLL_INTERVAL_MS) {
      lastPollTime = millis();
      Serial.println("[POLL] Verificando comandos...");

      checkCommands();

      // Sync periodico (a cada 5 min)
      static int pollCount = 0;
      pollCount++;
      if (pollCount >= 60) {  // 60 * 5s = 5 min
        pollCount = 0;
        fetchSchedules();
        sendStatus();

        // Se power_save foi ativado no site, muda para Deep Sleep
        if (powerSaveEnabled) {
          Serial.println("[CONFIG] Modo economia ativado! Mudando para Deep Sleep...");
          activeMode = false;
          scheduleNextWakeup();
          return;
        }
      }
    }
    return;
  }

  // Modo normal nao deveria chegar aqui (usa Deep Sleep)
  delay(1000);
}
