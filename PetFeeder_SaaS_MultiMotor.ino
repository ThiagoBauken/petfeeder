/*
 * ═══════════════════════════════════════════════════════════════════
 * PetFeeder ESP32 - Cliente SaaS MULTI-COMPARTIMENTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * SUPORTE A 3 MOTORES (3 COMPARTIMENTOS)
 *
 * MOTOR 1 (Compartimento 1):
 *   IN1 → GPIO 16
 *   IN2 → GPIO 17
 *   IN3 → GPIO 18
 *   IN4 → GPIO 19
 *
 * MOTOR 2 (Compartimento 2):
 *   IN1 → GPIO 25
 *   IN2 → GPIO 26
 *   IN3 → GPIO 27
 *   IN4 → GPIO 32
 *
 * MOTOR 3 (Compartimento 3):
 *   IN1 → GPIO 12
 *   IN2 → GPIO 13
 *   IN3 → GPIO 14
 *   IN4 → GPIO 15
 *
 * SENSOR HC-SR04:
 *   TRIG → GPIO 23
 *   ECHO → GPIO 22
 *
 * ═══════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURAÇÃO DOS MOTORES
// ══════════════════════════════════════════════════════════════════

// Número de compartimentos/motores ativos (1, 2 ou 3)
#define NUM_COMPARTMENTS 1  // ALTERE PARA 2 OU 3 SE ADICIONAR MAIS MOTORES

// Motor 1 (Compartimento 1) - SEU CIRCUITO ATUAL
#define MOTOR1_IN1 16
#define MOTOR1_IN2 17
#define MOTOR1_IN3 18
#define MOTOR1_IN4 19

// Motor 2 (Compartimento 2) - OPCIONAL
#define MOTOR2_IN1 25
#define MOTOR2_IN2 26
#define MOTOR2_IN3 27
#define MOTOR2_IN4 32

// Motor 3 (Compartimento 3) - OPCIONAL
#define MOTOR3_IN1 12
#define MOTOR3_IN2 13
#define MOTOR3_IN3 14
#define MOTOR3_IN4 15

// Sensor Ultrassônico HC-SR04
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED indicador
#define LED_PIN 2

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURAÇÃO DO MOTOR
// ══════════════════════════════════════════════════════════════════

const int STEPS_PER_REVOLUTION = 2048;

// Configuração de doses (passos por tamanho)
// 1 volta = 2048 passos (motor 28BYJ-48)
const int DOSE_SMALL = 2048;   // ~50g - 1 volta
const int DOSE_MEDIUM = 4096;  // ~100g - 2 voltas
const int DOSE_LARGE = 6144;   // ~150g - 3 voltas

// Calibração: gramas por passo (para comandos em gramas)
float STEPS_PER_GRAM = 20.48;  // 2048 steps / 100g = 20.48

// Sequência Half-Step (mais suave)
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

// Estado de cada motor
int currentStep[3] = {0, 0, 0};

// Pinos de cada motor (array para fácil acesso)
const int motorPins[3][4] = {
  {MOTOR1_IN1, MOTOR1_IN2, MOTOR1_IN3, MOTOR1_IN4},
  {MOTOR2_IN1, MOTOR2_IN2, MOTOR2_IN3, MOTOR2_IN4},
  {MOTOR3_IN1, MOTOR3_IN2, MOTOR3_IN3, MOTOR3_IN4}
};

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURAÇÃO DO SERVIDOR
// ══════════════════════════════════════════════════════════════════

// !!! ALTERE PARA SEU SERVIDOR !!!
const char* MQTT_SERVER = "seu-servidor.com";
const int MQTT_PORT = 1883;
const String API_BASE_URL = "https://seu-servidor.com/api/v1";

// ══════════════════════════════════════════════════════════════════
//                    IDENTIFICAÇÃO DO DISPOSITIVO
// ══════════════════════════════════════════════════════════════════

String DEVICE_ID = "";
const String FIRMWARE_VERSION = "2.0.0";  // Versão com multi-motor

// Tópicos MQTT
String TOPIC_COMMAND = "";
String TOPIC_STATUS = "";
String TOPIC_TELEMETRY = "";
String TOPIC_CONFIG = "";

// ══════════════════════════════════════════════════════════════════
//                    OBJETOS GLOBAIS
// ══════════════════════════════════════════════════════════════════

WebServer server(80);
WiFiClient espClient;
PubSubClient mqtt(espClient);
Preferences preferences;

// ══════════════════════════════════════════════════════════════════
//                    ESTRUTURAS DE DADOS
// ══════════════════════════════════════════════════════════════════

struct Config {
  char wifi_ssid[32];
  char wifi_pass[64];
  char user_token[64];
  char mqtt_user[32];
  char mqtt_pass[64];
  bool configured;
  bool registered;
} config;

struct Pet {
  String name;
  int compartment;
  float dailyAmount;
  bool active;
};

struct Schedule {
  int hour;
  int minute;
  int compartment;
  String doseSize;  // "small", "medium", "large"
  int steps;
  bool active;
  bool days[7];
};

Pet pets[3];  // Até 3 pets (1 por compartimento)
Schedule schedules[10];
int scheduleCount = 0;

// ══════════════════════════════════════════════════════════════════
//                    VARIÁVEIS DE ESTADO
// ══════════════════════════════════════════════════════════════════

bool isAPMode = false;
bool isConnected = false;
float foodLevel = 0;
float distancia = 0;

unsigned long lastSensorRead = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastScheduleCheck = 0;

// ══════════════════════════════════════════════════════════════════
//                    SETUP
// ══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(1000);

  printBanner();

  // Gera ID único
  generateDeviceId();

  // Configura hardware
  setupMotors();
  setupSensor();
  pinMode(LED_PIN, OUTPUT);

  // Carrega configurações
  loadConfig();

  // Tenta conectar WiFi
  if (config.configured) {
    Serial.println("📶 Tentando conectar ao WiFi salvo...");
    if (connectWiFi(config.wifi_ssid, config.wifi_pass)) {
      Serial.println("✅ Conectado ao WiFi!");
      setupMQTT();
      connectMQTT();
    } else {
      Serial.println("❌ Falha na conexão. Iniciando portal...");
      startConfigPortal();
    }
  } else {
    Serial.println("⚙️ Primeira execução. Iniciando portal...");
    startConfigPortal();
  }
}

// ══════════════════════════════════════════════════════════════════
//                    LOOP PRINCIPAL
// ══════════════════════════════════════════════════════════════════

void loop() {
  if (isAPMode) {
    server.handleClient();
    blinkLED(500);
    return;
  }

  if (!mqtt.connected()) {
    connectMQTT();
  }
  mqtt.loop();

  if (millis() - lastSensorRead > 5000) {
    readSensor();
    sendTelemetry();
    lastSensorRead = millis();
  }

  if (millis() - lastHeartbeat > 30000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  if (millis() - lastScheduleCheck > 60000) {
    checkSchedules();
    lastScheduleCheck = millis();
  }

  digitalWrite(LED_PIN, HIGH);
}

// ══════════════════════════════════════════════════════════════════
//                    CONTROLE DOS MOTORES (MULTI)
// ══════════════════════════════════════════════════════════════════

void setupMotors() {
  // Configura pinos de todos os motores ativos
  for (int m = 0; m < NUM_COMPARTMENTS; m++) {
    for (int p = 0; p < 4; p++) {
      pinMode(motorPins[m][p], OUTPUT);
    }
    stopMotor(m);
  }

  Serial.printf("🔧 %d motor(es) configurado(s)\n", NUM_COMPARTMENTS);
}

void runMotor(int motorIndex, int steps) {
  if (motorIndex < 0 || motorIndex >= NUM_COMPARTMENTS) {
    Serial.printf("❌ Motor %d não disponível!\n", motorIndex + 1);
    return;
  }

  Serial.printf("🔄 Motor %d: %d passos\n", motorIndex + 1, steps);

  for (int i = 0; i < steps; i++) {
    // Aplica sequência nos pinos do motor específico
    digitalWrite(motorPins[motorIndex][0], stepSequence[currentStep[motorIndex]][0]);
    digitalWrite(motorPins[motorIndex][1], stepSequence[currentStep[motorIndex]][1]);
    digitalWrite(motorPins[motorIndex][2], stepSequence[currentStep[motorIndex]][2]);
    digitalWrite(motorPins[motorIndex][3], stepSequence[currentStep[motorIndex]][3]);

    currentStep[motorIndex]++;
    if (currentStep[motorIndex] >= 8) currentStep[motorIndex] = 0;

    delayMicroseconds(2000);
  }

  stopMotor(motorIndex);
}

void stopMotor(int motorIndex) {
  if (motorIndex < 0 || motorIndex >= NUM_COMPARTMENTS) return;

  for (int p = 0; p < 4; p++) {
    digitalWrite(motorPins[motorIndex][p], LOW);
  }
}

void stopAllMotors() {
  for (int m = 0; m < NUM_COMPARTMENTS; m++) {
    stopMotor(m);
  }
}

// Dispensa ração por COMPARTIMENTO e DOSE
void dispenseFeed(int compartment, String doseSize) {
  int motorIndex = compartment - 1;  // Compartimento 1 = Motor 0

  if (motorIndex < 0 || motorIndex >= NUM_COMPARTMENTS) {
    Serial.printf("❌ Compartimento %d não disponível!\n", compartment);
    return;
  }

  int steps = DOSE_MEDIUM;  // Default
  float grams = 100;

  if (doseSize == "small") {
    steps = DOSE_SMALL;
    grams = 50;   // 1 volta
  } else if (doseSize == "medium") {
    steps = DOSE_MEDIUM;
    grams = 100;  // 2 voltas
  } else if (doseSize == "large") {
    steps = DOSE_LARGE;
    grams = 150;  // 3 voltas
  }

  Serial.printf("🍽️ Compartimento %d: Dose %s (%.0fg, %d passos)\n",
                compartment, doseSize.c_str(), grams, steps);

  runMotor(motorIndex, steps);
  sendFeedingLog(compartment, grams, doseSize);

  Serial.println("✅ Alimentação completa!");
}

// Dispensa ração por GRAMAS (compatibilidade)
void dispenseFeedGrams(int compartment, float grams) {
  int motorIndex = compartment - 1;

  if (motorIndex < 0 || motorIndex >= NUM_COMPARTMENTS) {
    Serial.printf("❌ Compartimento %d não disponível!\n", compartment);
    return;
  }

  int steps = (int)(grams * STEPS_PER_GRAM);

  Serial.printf("🍽️ Compartimento %d: %.1fg (%d passos)\n", compartment, grams, steps);

  runMotor(motorIndex, steps);

  // Determina o tamanho da dose
  String doseSize = "medium";
  if (grams <= 30) doseSize = "small";
  else if (grams >= 80) doseSize = "large";

  sendFeedingLog(compartment, grams, doseSize);

  Serial.println("✅ Alimentação completa!");
}

// ══════════════════════════════════════════════════════════════════
//                    COMANDOS MQTT
// ══════════════════════════════════════════════════════════════════

void handleCommand(JsonDocument& doc) {
  String cmd = doc["command"];

  Serial.println("⚡ Comando: " + cmd);

  if (cmd == "feed") {
    // Novo formato: compartimento + dose
    int compartment = doc["compartment"] | 1;
    String doseSize = doc["doseSize"] | "medium";

    // Compatibilidade: se enviou amount em gramas
    if (doc.containsKey("amount")) {
      float amount = doc["amount"];
      dispenseFeedGrams(compartment, amount);
    } else {
      dispenseFeed(compartment, doseSize);
    }

  } else if (cmd == "calibrate") {
    int compartment = doc["compartment"] | 1;
    int steps = doc["steps"] | 500;
    int motorIndex = compartment - 1;
    runMotor(motorIndex, steps);

  } else if (cmd == "testMotor") {
    int compartment = doc["compartment"] | 1;
    int motorIndex = compartment - 1;
    Serial.printf("🧪 Testando motor %d...\n", compartment);
    runMotor(motorIndex, 512);  // 1/4 volta

  } else if (cmd == "restart") {
    sendStatus("restarting");
    delay(1000);
    ESP.restart();

  } else if (cmd == "getStatus") {
    sendFullStatus();
  }
}

void handleConfig(JsonDocument& doc) {
  Serial.println("⚙️ Configuração recebida");

  // Configuração de pets por compartimento
  if (doc.containsKey("pets")) {
    JsonArray petsArr = doc["pets"];
    int idx = 0;
    for (JsonObject p : petsArr) {
      if (idx >= 3) break;
      pets[idx].name = p["name"].as<String>();
      pets[idx].compartment = p["compartment"] | (idx + 1);
      pets[idx].dailyAmount = p["dailyAmount"] | 100;
      pets[idx].active = p["active"] | true;
      idx++;
    }
  }

  // Configuração de horários
  if (doc.containsKey("schedules")) {
    JsonArray arr = doc["schedules"];
    scheduleCount = 0;

    for (JsonObject s : arr) {
      if (scheduleCount >= 10) break;

      schedules[scheduleCount].hour = s["hour"];
      schedules[scheduleCount].minute = s["minute"];
      schedules[scheduleCount].compartment = s["compartment"] | 1;
      schedules[scheduleCount].doseSize = s["doseSize"] | "medium";
      schedules[scheduleCount].active = s["active"] | true;

      // Converter dose para passos
      String dose = schedules[scheduleCount].doseSize;
      if (dose == "small") schedules[scheduleCount].steps = DOSE_SMALL;
      else if (dose == "large") schedules[scheduleCount].steps = DOSE_LARGE;
      else schedules[scheduleCount].steps = DOSE_MEDIUM;

      JsonArray days = s["days"];
      for (int d = 0; d < 7; d++) {
        schedules[scheduleCount].days[d] = days[d];
      }

      scheduleCount++;
    }

    Serial.printf("📅 %d horários configurados\n", scheduleCount);
  }

  // Calibração
  if (doc.containsKey("stepsPerGram")) {
    STEPS_PER_GRAM = doc["stepsPerGram"];
    preferences.putFloat("stepsGram", STEPS_PER_GRAM);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    ENVIO DE DADOS
// ══════════════════════════════════════════════════════════════════

void sendFeedingLog(int compartment, float grams, String doseSize) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["compartment"] = compartment;
  doc["amount"] = grams;
  doc["doseSize"] = doseSize;
  doc["timestamp"] = millis();

  String json;
  serializeJson(doc, json);

  String topic = "devices/" + DEVICE_ID + "/feeding";
  mqtt.publish(topic.c_str(), json.c_str());
}

void sendFullStatus() {
  StaticJsonDocument<768> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["compartments"] = NUM_COMPARTMENTS;
  doc["uptime"] = millis() / 1000;
  doc["heap"] = ESP.getFreeHeap();
  doc["rssi"] = WiFi.RSSI();
  doc["foodLevel"] = foodLevel;

  // Info de cada compartimento
  JsonArray comps = doc.createNestedArray("compartmentStatus");
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    JsonObject comp = comps.createNestedObject();
    comp["compartment"] = i + 1;
    comp["active"] = true;
    if (pets[i].name.length() > 0) {
      comp["petName"] = pets[i].name;
    }
  }

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_STATUS.c_str(), json.c_str());
}

void sendStatus(String status) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["compartments"] = NUM_COMPARTMENTS;
  doc["ip"] = WiFi.localIP().toString();
  doc["firmware"] = FIRMWARE_VERSION;

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_STATUS.c_str(), json.c_str(), true);
}

void sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["uptime"] = millis() / 1000;
  doc["heap"] = ESP.getFreeHeap();
  doc["rssi"] = WiFi.RSSI();
  doc["compartments"] = NUM_COMPARTMENTS;

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_STATUS.c_str(), json.c_str());
}

void sendTelemetry() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["foodLevel"] = foodLevel;
  doc["distance"] = distancia;
  doc["compartments"] = NUM_COMPARTMENTS;

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_TELEMETRY.c_str(), json.c_str());

  if (foodLevel < 20) {
    StaticJsonDocument<128> alert;
    alert["deviceId"] = DEVICE_ID;
    alert["type"] = "low_food";
    alert["level"] = foodLevel;

    String alertJson;
    serializeJson(alert, alertJson);

    String alertTopic = "devices/" + DEVICE_ID + "/alert";
    mqtt.publish(alertTopic.c_str(), alertJson.c_str());
  }
}

// ══════════════════════════════════════════════════════════════════
//                    SENSOR ULTRASSÔNICO
// ══════════════════════════════════════════════════════════════════

void setupSensor() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void readSensor() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration > 0) {
    distancia = duration * 0.034 / 2.0;
    foodLevel = constrain(map(distancia, 30, 5, 0, 100), 0, 100);
    Serial.printf("📏 Distância: %.1f cm | Nível: %.0f%%\n", distancia, foodLevel);
  } else {
    Serial.println("⚠️ Erro na leitura do sensor");
  }
}

// ══════════════════════════════════════════════════════════════════
//                    MQTT (igual ao original)
// ══════════════════════════════════════════════════════════════════

void setupMQTT() {
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1024);

  TOPIC_COMMAND = "devices/" + DEVICE_ID + "/command";
  TOPIC_STATUS = "devices/" + DEVICE_ID + "/status";
  TOPIC_TELEMETRY = "devices/" + DEVICE_ID + "/telemetry";
  TOPIC_CONFIG = "devices/" + DEVICE_ID + "/config";
}

void connectMQTT() {
  if (mqtt.connected()) return;

  Serial.print("🔄 Conectando MQTT...");

  String clientId = DEVICE_ID + "_" + String(random(0xffff), HEX);

  if (mqtt.connect(clientId.c_str(), config.mqtt_user, config.mqtt_pass)) {
    Serial.println(" ✅");
    mqtt.subscribe(TOPIC_COMMAND.c_str());
    mqtt.subscribe(TOPIC_CONFIG.c_str());
    sendStatus("online");
  } else {
    Serial.printf(" ❌ Erro: %d\n", mqtt.state());
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.println("📨 MQTT: " + String(topic));
  Serial.println("   " + message);

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, message)) {
    Serial.println("❌ Erro ao parsear JSON");
    return;
  }

  String topicStr = String(topic);

  if (topicStr == TOPIC_COMMAND) {
    handleCommand(doc);
  } else if (topicStr == TOPIC_CONFIG) {
    handleConfig(doc);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    PORTAL DE CONFIGURAÇÃO (igual ao original)
// ══════════════════════════════════════════════════════════════════

void startConfigPortal() {
  isAPMode = true;

  String apName = "PetFeeder_" + DEVICE_ID.substring(3, 9);
  WiFi.softAP(apName.c_str(), "12345678");

  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║     PORTAL DE CONFIGURAÇÃO           ║");
  Serial.println("╠══════════════════════════════════════╣");
  Serial.printf("║  WiFi: %-30s║\n", apName.c_str());
  Serial.println("║  Senha: 12345678                     ║");
  Serial.println("║  Acesse: http://192.168.4.1          ║");
  Serial.printf("║  Compartimentos: %d                   ║\n", NUM_COMPARTMENTS);
  Serial.println("╚══════════════════════════════════════╝\n");

  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/status", handleStatusPage);
  server.on("/test", HTTP_POST, handleTest);
  server.onNotFound(handleRoot);

  server.begin();
  Serial.println("🌐 Servidor web iniciado!");
}

void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PetFeeder - Configuração</title>
  <style>
    * { box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
    body {
      margin: 0; padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .container {
      max-width: 400px; margin: 0 auto;
      background: white; padding: 30px;
      border-radius: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    h1 { text-align: center; color: #333; margin-bottom: 10px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 20px; }
    .device-info {
      background: #f0f0f0; padding: 15px;
      border-radius: 8px; margin-bottom: 20px;
      font-family: monospace; font-size: 12px;
    }
    .device-info div { margin: 5px 0; }
    label { display: block; margin-bottom: 5px; color: #333; font-weight: 600; }
    input, select {
      width: 100%; padding: 12px; margin-bottom: 20px;
      border: 2px solid #e0e0e0; border-radius: 10px; font-size: 16px;
    }
    input:focus, select:focus { outline: none; border-color: #667eea; }
    button {
      width: 100%; padding: 15px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border: none; border-radius: 10px;
      font-size: 18px; font-weight: 600; cursor: pointer;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4); }
    .scan-btn { background: #28a745; margin-bottom: 10px; padding: 10px; font-size: 14px; }
    .test-btn { background: #ffc107; color: #333; margin-top: 10px; font-size: 14px; padding: 10px; }
    .networks { max-height: 150px; overflow-y: auto; margin-bottom: 20px; }
    .network {
      padding: 10px; background: #f8f9fa; margin: 5px 0;
      border-radius: 8px; cursor: pointer;
      display: flex; justify-content: space-between;
    }
    .network:hover { background: #e9ecef; }
    .info { background: #e7f3ff; border: 1px solid #b6d4fe; padding: 15px; border-radius: 10px; margin-bottom: 20px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐾 PetFeeder</h1>
    <p class="subtitle">Configuração Multi-Compartimento</p>

    <div class="device-info">
      <div><strong>ID:</strong> )rawliteral" + DEVICE_ID + R"rawliteral(</div>
      <div><strong>Firmware:</strong> )rawliteral" + FIRMWARE_VERSION + R"rawliteral(</div>
      <div><strong>Compartimentos:</strong> )rawliteral" + String(NUM_COMPARTMENTS) + R"rawliteral(</div>
    </div>

    <button class="scan-btn" onclick="scanNetworks()">🔍 Buscar Redes WiFi</button>
    <div id="networks" class="networks"></div>

    <form action="/save" method="POST">
      <label>Rede WiFi:</label>
      <input type="text" name="ssid" id="ssid" placeholder="Nome da rede" required>

      <label>Senha WiFi:</label>
      <input type="password" name="pass" placeholder="Senha da rede" required>

      <label>Token do Usuário:</label>
      <input type="text" name="token" placeholder="Cole seu token aqui" required>

      <button type="submit">💾 Salvar e Conectar</button>
    </form>

    <button class="test-btn" onclick="testMotor()">🔧 Testar Motor 1</button>
  </div>

  <script>
    function scanNetworks() {
      document.getElementById('networks').innerHTML = '<p style="text-align:center">Buscando...</p>';
      fetch('/scan')
        .then(r => r.json())
        .then(data => {
          let html = '';
          data.networks.forEach(n => {
            html += '<div class="network" onclick="selectNetwork(\'' + n.ssid + '\')">' +
                    '<span>' + n.ssid + '</span>' +
                    '<span>' + n.rssi + ' dBm</span></div>';
          });
          document.getElementById('networks').innerHTML = html || '<p>Nenhuma rede encontrada</p>';
        });
    }
    function selectNetwork(ssid) { document.getElementById('ssid').value = ssid; }
    function testMotor() {
      fetch('/test', { method: 'POST', body: 'motor=1' })
        .then(() => alert('Motor 1 testado!'));
    }
    setTimeout(scanNetworks, 500);
  </script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

void handleScan() {
  int n = WiFi.scanNetworks();
  String json = "{\"networks\":[";
  for (int i = 0; i < n; i++) {
    if (i > 0) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]}";
  server.send(200, "application/json", json);
}

void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  String token = server.arg("token");

  ssid.toCharArray(config.wifi_ssid, 32);
  pass.toCharArray(config.wifi_pass, 64);
  token.toCharArray(config.user_token, 64);
  config.configured = true;

  saveConfig();

  String html;
  if (connectWiFi(config.wifi_ssid, config.wifi_pass)) {
    if (registerDevice()) {
      html = "<html><body style='text-align:center;padding:50px;background:#d4edda'>";
      html += "<h1>✅ Sucesso!</h1><p>Reiniciando em 5s...</p></body></html>";
      server.send(200, "text/html", html);
      delay(5000);
      ESP.restart();
    } else {
      html = "<html><body style='text-align:center;padding:50px;background:#f8d7da'>";
      html += "<h1>⚠️ WiFi OK, registro falhou</h1><a href='/'>Voltar</a></body></html>";
      server.send(200, "text/html", html);
    }
  } else {
    html = "<html><body style='text-align:center;padding:50px;background:#f8d7da'>";
    html += "<h1>❌ Falha WiFi</h1><a href='/'>Voltar</a></body></html>";
    server.send(200, "text/html", html);
  }
}

void handleStatusPage() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["compartments"] = NUM_COMPARTMENTS;
  doc["configured"] = config.configured;
  doc["connected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = WiFi.localIP().toString();

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleTest() {
  int motor = server.arg("motor").toInt();
  if (motor < 1) motor = 1;
  if (motor > NUM_COMPARTMENTS) motor = NUM_COMPARTMENTS;

  Serial.printf("🧪 Teste motor %d via portal\n", motor);
  runMotor(motor - 1, 512);

  server.send(200, "text/plain", "OK");
}

// ══════════════════════════════════════════════════════════════════
//                    CONEXÃO WiFi & REGISTRO
// ══════════════════════════════════════════════════════════════════

bool connectWiFi(const char* ssid, const char* password) {
  Serial.printf("📶 Conectando a %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" ✅");
    Serial.println("   IP: " + WiFi.localIP().toString());
    isAPMode = false;
    isConnected = true;
    return true;
  }

  Serial.println(" ❌");
  return false;
}

bool registerDevice() {
  Serial.println("📝 Registrando dispositivo...");

  HTTPClient http;
  http.begin(API_BASE_URL + "/devices/register");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + String(config.user_token));

  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["deviceType"] = "PETFEEDER_V2_MULTI";
  doc["firmware"] = FIRMWARE_VERSION;
  doc["compartments"] = NUM_COMPARTMENTS;
  doc["mac"] = WiFi.macAddress();
  doc["ip"] = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    StaticJsonDocument<512> responseDoc;
    deserializeJson(responseDoc, response);

    String mqttUser = responseDoc["mqttUser"].as<String>();
    String mqttPass = responseDoc["mqttPass"].as<String>();

    mqttUser.toCharArray(config.mqtt_user, 32);
    mqttPass.toCharArray(config.mqtt_pass, 64);
    config.registered = true;

    saveConfig();
    Serial.println("✅ Dispositivo registrado!");
    http.end();
    return true;
  }

  Serial.printf("❌ Erro no registro: %d\n", httpCode);
  http.end();
  return false;
}

// ══════════════════════════════════════════════════════════════════
//                    AGENDAMENTO
// ══════════════════════════════════════════════════════════════════

void checkSchedules() {
  Serial.println("⏰ Verificando horários...");
  // TODO: Implementar com NTP ou RTC
}

// ══════════════════════════════════════════════════════════════════
//                    PERSISTÊNCIA
// ══════════════════════════════════════════════════════════════════

void saveConfig() {
  preferences.begin("petfeeder", false);
  preferences.putString("ssid", config.wifi_ssid);
  preferences.putString("pass", config.wifi_pass);
  preferences.putString("token", config.user_token);
  preferences.putString("mqttUser", config.mqtt_user);
  preferences.putString("mqttPass", config.mqtt_pass);
  preferences.putBool("configured", config.configured);
  preferences.putBool("registered", config.registered);
  preferences.end();
  Serial.println("💾 Configuração salva!");
}

void loadConfig() {
  preferences.begin("petfeeder", true);
  String ssid = preferences.getString("ssid", "");
  String pass = preferences.getString("pass", "");
  String token = preferences.getString("token", "");
  String mqttUser = preferences.getString("mqttUser", "");
  String mqttPass = preferences.getString("mqttPass", "");

  ssid.toCharArray(config.wifi_ssid, 32);
  pass.toCharArray(config.wifi_pass, 64);
  token.toCharArray(config.user_token, 64);
  mqttUser.toCharArray(config.mqtt_user, 32);
  mqttPass.toCharArray(config.mqtt_pass, 64);

  config.configured = preferences.getBool("configured", false);
  config.registered = preferences.getBool("registered", false);
  STEPS_PER_GRAM = preferences.getFloat("stepsGram", 20.48);

  preferences.end();
  Serial.println("📂 Configuração carregada");
}

// ══════════════════════════════════════════════════════════════════
//                    UTILIDADES
// ══════════════════════════════════════════════════════════════════

void generateDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  DEVICE_ID = "PF_";
  for (int i = 0; i < 6; i++) {
    if (mac[i] < 0x10) DEVICE_ID += "0";
    DEVICE_ID += String(mac[i], HEX);
  }
  DEVICE_ID.toUpperCase();
  Serial.println("🆔 Device ID: " + DEVICE_ID);
}

void blinkLED(int interval) {
  static unsigned long lastBlink = 0;
  static bool ledState = false;
  if (millis() - lastBlink > interval) {
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
    lastBlink = millis();
  }
}

void printBanner() {
  Serial.println("\n");
  Serial.println("╔═══════════════════════════════════════════════════╗");
  Serial.println("║  🐾 PetFeeder ESP32 - MULTI-COMPARTIMENTO         ║");
  Serial.println("║     Versão " + FIRMWARE_VERSION + " - Suporte a 3 Motores           ║");
  Serial.println("╠═══════════════════════════════════════════════════╣");
  Serial.printf("║  Compartimentos ativos: %d                         ║\n", NUM_COMPARTMENTS);
  Serial.println("╠═══════════════════════════════════════════════════╣");
  Serial.println("║  Motor 1: GPIO 16, 17, 18, 19                     ║");
  if (NUM_COMPARTMENTS >= 2)
  Serial.println("║  Motor 2: GPIO 25, 26, 27, 32                     ║");
  if (NUM_COMPARTMENTS >= 3)
  Serial.println("║  Motor 3: GPIO 12, 13, 14, 15                     ║");
  Serial.println("║  Sensor:  GPIO 23 (TRIG), 22 (ECHO)               ║");
  Serial.println("╚═══════════════════════════════════════════════════╝");
  Serial.println("");
}
