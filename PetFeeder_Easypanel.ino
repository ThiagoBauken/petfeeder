/*
 * ═══════════════════════════════════════════════════════════════════
 * PetFeeder ESP32 - VERSÃO EASYPANEL (HTTPS)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Comunicação via HTTPS com servidor Easypanel
 * Sem necessidade de MQTT
 *
 * MOTOR 1 (Compartimento 1):
 *   IN1 → GPIO 16
 *   IN2 → GPIO 17
 *   IN3 → GPIO 18
 *   IN4 → GPIO 19
 *
 * SENSOR HC-SR04:
 *   TRIG → GPIO 23
 *   ECHO → GPIO 22
 *
 * ═══════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// ══════════════════════════════════════════════════════════════════
//                    🔧 CONFIGURAÇÃO - ALTERE AQUI!
// ══════════════════════════════════════════════════════════════════

// URL do seu servidor Easypanel (sem / no final)
const char* SERVER_URL = "https://telegram-petfeeder.pbzgje.easypanel.host";

// ══════════════════════════════════════════════════════════════════
//                    PINOS DO HARDWARE
// ══════════════════════════════════════════════════════════════════

// Motor 28BYJ-48 via ULN2003
#define MOTOR_IN1 16
#define MOTOR_IN2 17
#define MOTOR_IN3 18
#define MOTOR_IN4 19

// Sensor HC-SR04
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED indicador
#define LED_PIN 2

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURAÇÃO DE DOSES
// ══════════════════════════════════════════════════════════════════

const int STEPS_PER_REVOLUTION = 2048;
const int DOSE_SMALL = 2048;   // 1 volta (~50g)
const int DOSE_MEDIUM = 4096;  // 2 voltas (~100g)
const int DOSE_LARGE = 6144;   // 3 voltas (~150g)

// Half-step sequence (mais suave)
const int stepSequence[8][4] = {
  {1, 0, 0, 0},
  {1, 1, 0, 0},
  {0, 1, 0, 0},
  {0, 1, 1, 0},
  {0, 0, 1, 0},
  {0, 0, 1, 1},
  {0, 0, 0, 1},
  {1, 0, 0, 1}
};

// ══════════════════════════════════════════════════════════════════
//                    OBJETOS GLOBAIS
// ══════════════════════════════════════════════════════════════════

WebServer server(80);
Preferences preferences;
WiFiClientSecure httpsClient;

// ══════════════════════════════════════════════════════════════════
//                    VARIÁVEIS
// ══════════════════════════════════════════════════════════════════

String DEVICE_ID = "";
bool isAPMode = false;
bool isConnected = false;
int currentStep = 0;
float foodLevel = 0;
float distanceCm = 0;

// Configuração WiFi
struct Config {
  char wifi_ssid[32];
  char wifi_pass[64];
  bool configured;
} config;

// Timers
unsigned long lastSensorRead = 0;
unsigned long lastServerCheck = 0;
unsigned long lastStatusSend = 0;

// ══════════════════════════════════════════════════════════════════
//                    SETUP
// ══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n");
  Serial.println("╔═══════════════════════════════════════════════════════╗");
  Serial.println("║          PetFeeder ESP32 - Easypanel Edition          ║");
  Serial.println("║                   Versão HTTPS 1.0                    ║");
  Serial.println("╚═══════════════════════════════════════════════════════╝");

  // Gera ID único baseado no MAC
  uint8_t mac[6];
  WiFi.macAddress(mac);
  DEVICE_ID = String(mac[3], HEX) + String(mac[4], HEX) + String(mac[5], HEX);
  DEVICE_ID.toUpperCase();
  Serial.println("📱 Device ID: " + DEVICE_ID);
  Serial.println("🌐 Servidor: " + String(SERVER_URL));

  // Configura pinos
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);

  // Desliga motor
  stopMotor();

  // Carrega config
  loadConfig();

  // HTTPS - ignora certificado (para testes)
  httpsClient.setInsecure();

  // Conecta ou inicia portal
  if (config.configured) {
    Serial.println("📶 Conectando ao WiFi: " + String(config.wifi_ssid));
    if (connectWiFi(config.wifi_ssid, config.wifi_pass)) {
      Serial.println("✅ Conectado! IP: " + WiFi.localIP().toString());
      isConnected = true;
      registerDevice();
    } else {
      Serial.println("❌ Falha! Iniciando portal de configuração...");
      startConfigPortal();
    }
  } else {
    Serial.println("⚙️ Primeira execução - Iniciando portal...");
    startConfigPortal();
  }
}

// ══════════════════════════════════════════════════════════════════
//                    LOOP
// ══════════════════════════════════════════════════════════════════

void loop() {
  // Modo AP - portal de configuração
  if (isAPMode) {
    server.handleClient();
    blinkLED(500);
    return;
  }

  // Reconecta se desconectou
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi desconectado. Reconectando...");
    isConnected = false;
    connectWiFi(config.wifi_ssid, config.wifi_pass);
    return;
  }

  // Lê sensor a cada 5s
  if (millis() - lastSensorRead > 5000) {
    readSensor();
    lastSensorRead = millis();
  }

  // Verifica comandos do servidor a cada 3s
  if (millis() - lastServerCheck > 3000) {
    checkCommands();
    lastServerCheck = millis();
  }

  // Envia status a cada 30s
  if (millis() - lastStatusSend > 30000) {
    sendStatus();
    lastStatusSend = millis();
  }

  delay(10);
}

// ══════════════════════════════════════════════════════════════════
//                    WIFI
// ══════════════════════════════════════════════════════════════════

bool connectWiFi(const char* ssid, const char* pass) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    isConnected = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }
  return false;
}

void startConfigPortal() {
  isAPMode = true;

  String apName = "PetFeeder_" + DEVICE_ID;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str(), "12345678");

  Serial.println("\n════════════════════════════════════════");
  Serial.println("📡 PORTAL DE CONFIGURAÇÃO ATIVO");
  Serial.println("════════════════════════════════════════");
  Serial.println("WiFi: " + apName);
  Serial.println("Senha: 12345678");
  Serial.println("URL: http://192.168.4.1");
  Serial.println("════════════════════════════════════════\n");

  setupWebRoutes();
  server.begin();
}

void setupWebRoutes() {
  // Página principal
  server.on("/", HTTP_GET, []() {
    String html = R"(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PetFeeder Setup</title>
  <style>
    * { box-sizing: border-box; font-family: Arial, sans-serif; }
    body { margin: 0; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
    .card { background: white; border-radius: 20px; padding: 30px; max-width: 400px; margin: 0 auto; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
    h1 { color: #333; text-align: center; margin-bottom: 10px; }
    .subtitle { color: #666; text-align: center; margin-bottom: 30px; }
    input { width: 100%; padding: 15px; margin: 10px 0; border: 2px solid #ddd; border-radius: 10px; font-size: 16px; }
    input:focus { border-color: #667eea; outline: none; }
    button { width: 100%; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 10px; font-size: 18px; cursor: pointer; margin-top: 20px; }
    button:hover { opacity: 0.9; }
    .icon { font-size: 60px; text-align: center; margin-bottom: 20px; }
    .info { background: #f0f0f0; padding: 15px; border-radius: 10px; margin-top: 20px; }
    .info p { margin: 5px 0; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🐕</div>
    <h1>PetFeeder</h1>
    <p class="subtitle">Configure seu alimentador</p>
    <form action="/save" method="POST">
      <input type="text" name="ssid" placeholder="Nome da rede WiFi" required>
      <input type="password" name="pass" placeholder="Senha do WiFi" required>
      <button type="submit">Conectar</button>
    </form>
    <div class="info">
      <p>📱 Device: )" + DEVICE_ID + R"(</p>
      <p>🌐 Servidor: )" + String(SERVER_URL) + R"(</p>
    </div>
  </div>
</body>
</html>
)";
    server.send(200, "text/html", html);
  });

  // Salva configuração
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
  <title>Salvo!</title>
  <style>
    body { margin: 0; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 20px; padding: 40px; text-align: center; }
    .icon { font-size: 80px; }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Configurado!</h1>
    <p>O dispositivo vai reiniciar e conectar ao WiFi.</p>
    <p>Acesse o dashboard para controlar.</p>
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

    Serial.println("🍽️ Alimentação manual: " + size);
    dispense(steps);
    server.send(200, "application/json", "{\"success\":true,\"message\":\"Alimentação concluída\"}");
  });

  // Status
  server.on("/status", HTTP_GET, []() {
    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["food_level"] = foodLevel;
    doc["distance_cm"] = distanceCm;
    doc["connected"] = isConnected;
    doc["ip"] = WiFi.localIP().toString();

    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
  });
}

// ══════════════════════════════════════════════════════════════════
//                    COMUNICAÇÃO COM SERVIDOR
// ══════════════════════════════════════════════════════════════════

void registerDevice() {
  Serial.println("📝 Registrando dispositivo no servidor...");

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/register";

  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["firmware"] = "1.0.0";
  doc["ip"] = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);

  if (code > 0) {
    Serial.println("✅ Registrado! Código: " + String(code));
  } else {
    Serial.println("⚠️ Erro ao registrar: " + String(code));
  }

  http.end();
}

void checkCommands() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/commands";

  http.begin(httpsClient, url);
  int code = http.GET();

  if (code == 200) {
    String response = http.getString();

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error && doc.containsKey("command")) {
      String cmd = doc["command"].as<String>();

      if (cmd == "feed") {
        String size = doc["size"] | "medium";
        int steps = DOSE_MEDIUM;

        if (size == "small") steps = DOSE_SMALL;
        else if (size == "large") steps = DOSE_LARGE;

        Serial.println("📡 Comando do servidor: ALIMENTAR " + size);
        dispense(steps);
        sendFeedingLog(size, steps);
      }
    }
  }

  http.end();
}

void sendStatus() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/status";

  http.begin(httpsClient, url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["online"] = true;
  doc["food_level"] = foodLevel;
  doc["distance_cm"] = distanceCm;
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);

  if (code == 200) {
    Serial.println("📤 Status enviado");
  }

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
  doc["trigger"] = "remote";

  String body;
  serializeJson(doc, body);

  http.POST(body);
  http.end();
}

// ══════════════════════════════════════════════════════════════════
//                    MOTOR
// ══════════════════════════════════════════════════════════════════

void dispense(int steps) {
  Serial.println("🔄 Dispensando: " + String(steps) + " passos");
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

  // Atualiza nível após dispensar
  delay(500);
  readSensor();

  Serial.println("✅ Dispensado!");
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
  distanceCm = duration * 0.034 / 2;

  // Converte para nível (0-100%)
  // Assume: 5cm = cheio (100%), 20cm = vazio (0%)
  if (distanceCm < 5) {
    foodLevel = 100;
  } else if (distanceCm > 20) {
    foodLevel = 0;
  } else {
    foodLevel = map(distanceCm, 20, 5, 0, 100);
  }

  Serial.printf("📏 Sensor: %.1fcm | Nível: %.0f%%\n", distanceCm, foodLevel);
}

// ══════════════════════════════════════════════════════════════════
//                    CONFIG
// ══════════════════════════════════════════════════════════════════

void loadConfig() {
  preferences.begin("petfeeder", true);
  preferences.getString("ssid", config.wifi_ssid, 32);
  preferences.getString("pass", config.wifi_pass, 64);
  config.configured = preferences.getBool("configured", false);
  preferences.end();
}

void saveConfig() {
  preferences.begin("petfeeder", false);
  preferences.putString("ssid", config.wifi_ssid);
  preferences.putString("pass", config.wifi_pass);
  preferences.putBool("configured", config.configured);
  preferences.end();
}

void blinkLED(int interval) {
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > interval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = millis();
  }
}
