/*
 * ═══════════════════════════════════════════════════════════════════
 * PetFeeder ESP32 - Cliente SaaS COMPLETO
 * ═══════════════════════════════════════════════════════════════════
 *
 * PINAGEM CONFIGURADA PARA SEU CIRCUITO:
 *
 * MOTOR 28BYJ-48 (via ULN2003):
 *   IN1 → GPIO 16
 *   IN2 → GPIO 17
 *   IN3 → GPIO 18
 *   IN4 → GPIO 19
 *
 * SENSOR HC-SR04:
 *   TRIG → GPIO 23
 *   ECHO → GPIO 22
 *
 * ALIMENTAÇÃO:
 *   VCC Motor/Sensor → 5V
 *   GND → GND comum
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
//                    CONFIGURAÇÃO DOS PINOS
// ══════════════════════════════════════════════════════════════════

// Motor de Passo 28BYJ-48 (SEU CIRCUITO)
#define IN1 16
#define IN2 17
#define IN3 18
#define IN4 19

// Sensor Ultrassônico HC-SR04 (SEU CIRCUITO)
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED indicador (LED interno do ESP32)
#define LED_PIN 2

// ══════════════════════════════════════════════════════════════════
//                    CONFIGURAÇÃO DO MOTOR
// ══════════════════════════════════════════════════════════════════

const int STEPS_PER_REVOLUTION = 2048;
float STEPS_PER_GRAM = 41.0;  // Ajustar na calibração

// Sequência Half-Step (mais suave e preciso)
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

int currentStep = 0;

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
const String FIRMWARE_VERSION = "1.0.0";

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
  float dailyAmount;
  bool active;
};

struct Schedule {
  int hour;
  int minute;
  float amount;
  bool active;
  bool days[7];
};

Pet pet;
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

  // Gera ID único baseado no MAC
  generateDeviceId();

  // Configura hardware
  setupMotor();
  setupSensor();
  pinMode(LED_PIN, OUTPUT);

  // Carrega configurações salvas
  loadConfig();

  // Tenta conectar ao WiFi salvo
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
    Serial.println("⚙️ Primeira execução. Iniciando portal de configuração...");
    startConfigPortal();
  }
}

// ══════════════════════════════════════════════════════════════════
//                    LOOP PRINCIPAL
// ══════════════════════════════════════════════════════════════════

void loop() {
  // Modo AP - Portal de configuração
  if (isAPMode) {
    server.handleClient();
    blinkLED(500);  // Pisca lento = modo config
    return;
  }

  // Modo normal - Conectado

  // Mantém conexão MQTT
  if (!mqtt.connected()) {
    connectMQTT();
  }
  mqtt.loop();

  // Lê sensor a cada 5 segundos
  if (millis() - lastSensorRead > 5000) {
    readSensor();
    sendTelemetry();
    lastSensorRead = millis();
  }

  // Heartbeat a cada 30 segundos
  if (millis() - lastHeartbeat > 30000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }

  // Verifica horários a cada minuto
  if (millis() - lastScheduleCheck > 60000) {
    checkSchedules();
    lastScheduleCheck = millis();
  }

  // LED aceso = conectado
  digitalWrite(LED_PIN, HIGH);
}

// ══════════════════════════════════════════════════════════════════
//                    PORTAL DE CONFIGURAÇÃO WiFi
// ══════════════════════════════════════════════════════════════════

void startConfigPortal() {
  isAPMode = true;

  // Cria rede WiFi do ESP32
  String apName = "PetFeeder_" + DEVICE_ID.substring(3, 9);
  WiFi.softAP(apName.c_str(), "12345678");

  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║     PORTAL DE CONFIGURAÇÃO           ║");
  Serial.println("╠══════════════════════════════════════╣");
  Serial.printf("║  WiFi: %-30s║\n", apName.c_str());
  Serial.println("║  Senha: 12345678                     ║");
  Serial.println("║  Acesse: http://192.168.4.1          ║");
  Serial.println("╚══════════════════════════════════════╝\n");

  // Configura rotas do servidor web
  server.on("/", handleRoot);
  server.on("/scan", handleScan);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/status", handleStatus);
  server.onNotFound(handleRoot);

  server.begin();
  Serial.println("🌐 Servidor web iniciado!");
}

// Página principal do portal
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
      margin: 0;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .container {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    h1 {
      text-align: center;
      color: #333;
      margin-bottom: 10px;
      font-size: 24px;
    }
    .subtitle {
      text-align: center;
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .device-id {
      background: #f0f0f0;
      padding: 10px;
      border-radius: 8px;
      text-align: center;
      margin-bottom: 20px;
      font-family: monospace;
      font-size: 12px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      color: #333;
      font-weight: 600;
    }
    input, select {
      width: 100%;
      padding: 12px;
      margin-bottom: 20px;
      border: 2px solid #e0e0e0;
      border-radius: 10px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 15px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
    }
    button:active {
      transform: translateY(0);
    }
    .scan-btn {
      background: #28a745;
      margin-bottom: 10px;
      padding: 10px;
      font-size: 14px;
    }
    .networks {
      max-height: 150px;
      overflow-y: auto;
      margin-bottom: 20px;
    }
    .network {
      padding: 10px;
      background: #f8f9fa;
      margin: 5px 0;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .network:hover {
      background: #e9ecef;
    }
    .signal {
      font-size: 12px;
      color: #666;
    }
    .info {
      background: #e7f3ff;
      border: 1px solid #b6d4fe;
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 20px;
      font-size: 13px;
      color: #0c5460;
    }
    .success {
      background: #d4edda;
      border-color: #c3e6cb;
      color: #155724;
    }
    .error {
      background: #f8d7da;
      border-color: #f5c6cb;
      color: #721c24;
    }
    .step {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
    }
    .step-number {
      background: #667eea;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      margin-right: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐾 PetFeeder</h1>
    <p class="subtitle">Configuração do Dispositivo</p>

    <div class="device-id">
      ID: )rawliteral" + DEVICE_ID + R"rawliteral(
    </div>

    <div class="info">
      <div class="step">
        <span class="step-number">1</span>
        <span>Selecione sua rede WiFi</span>
      </div>
      <div class="step">
        <span class="step-number">2</span>
        <span>Digite a senha</span>
      </div>
      <div class="step">
        <span class="step-number">3</span>
        <span>Informe seu token (do site)</span>
      </div>
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
      <small style="color:#666; display:block; margin-top:-15px; margin-bottom:20px;">
        Obtenha no site: petfeeder.com → Minha Conta → Token
      </small>

      <button type="submit">💾 Salvar e Conectar</button>
    </form>

    <div id="message"></div>
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
                    '<span class="signal">' + n.rssi + ' dBm</span></div>';
          });
          document.getElementById('networks').innerHTML = html || '<p>Nenhuma rede encontrada</p>';
        })
        .catch(e => {
          document.getElementById('networks').innerHTML = '<p style="color:red">Erro ao buscar</p>';
        });
    }

    function selectNetwork(ssid) {
      document.getElementById('ssid').value = ssid;
    }

    // Busca redes automaticamente ao carregar
    setTimeout(scanNetworks, 500);
  </script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

// Escaneia redes WiFi
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

// Salva configuração
void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  String token = server.arg("token");

  Serial.println("📝 Salvando configuração...");
  Serial.println("   SSID: " + ssid);
  Serial.println("   Token: " + token.substring(0, 8) + "...");

  // Salva na estrutura
  ssid.toCharArray(config.wifi_ssid, 32);
  pass.toCharArray(config.wifi_pass, 64);
  token.toCharArray(config.user_token, 64);
  config.configured = true;

  // Salva na flash
  saveConfig();

  // Tenta conectar
  String html;
  if (connectWiFi(config.wifi_ssid, config.wifi_pass)) {
    // Registra no servidor
    if (registerDevice()) {
      html = R"(
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; background: #d4edda; }
            h1 { color: #155724; }
            p { color: #155724; }
          </style>
        </head>
        <body>
          <h1>✅ Sucesso!</h1>
          <p>Dispositivo configurado e registrado!</p>
          <p>Você já pode fechar esta página.</p>
          <p>O dispositivo irá reiniciar em 5 segundos...</p>
        </body>
        </html>
      )";
      server.send(200, "text/html", html);
      delay(5000);
      ESP.restart();
    } else {
      html = R"(
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; background: #f8d7da; }
            h1 { color: #721c24; }
          </style>
        </head>
        <body>
          <h1>⚠️ WiFi OK, mas falha no registro</h1>
          <p>Verifique seu token e tente novamente.</p>
          <a href="/">Voltar</a>
        </body>
        </html>
      )";
      server.send(200, "text/html", html);
    }
  } else {
    html = R"(
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial; text-align: center; padding: 50px; background: #f8d7da; }
          h1 { color: #721c24; }
        </style>
      </head>
      <body>
        <h1>❌ Falha na conexão WiFi</h1>
        <p>Verifique a senha e tente novamente.</p>
        <a href="/">Voltar</a>
      </body>
      </html>
    )";
    server.send(200, "text/html", html);
  }
}

void handleStatus() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["configured"] = config.configured;
  doc["connected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = WiFi.localIP().toString();

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// ══════════════════════════════════════════════════════════════════
//                    CONEXÃO WiFi
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

// ══════════════════════════════════════════════════════════════════
//                    REGISTRO NO SERVIDOR
// ══════════════════════════════════════════════════════════════════

bool registerDevice() {
  Serial.println("📝 Registrando dispositivo no servidor...");

  HTTPClient http;
  http.begin(API_BASE_URL + "/devices/register");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + String(config.user_token));

  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["deviceType"] = "PETFEEDER_V1";
  doc["firmware"] = FIRMWARE_VERSION;
  doc["mac"] = WiFi.macAddress();
  doc["ip"] = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();

    StaticJsonDocument<512> responseDoc;
    deserializeJson(responseDoc, response);

    // Salva credenciais MQTT retornadas pelo servidor
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
//                    MQTT
// ══════════════════════════════════════════════════════════════════

void setupMQTT() {
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(1024);

  // Configura tópicos
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

void handleCommand(JsonDocument& doc) {
  String cmd = doc["command"];

  Serial.println("⚡ Comando: " + cmd);

  if (cmd == "feed") {
    float amount = doc["amount"] | 30.0;
    dispenseFeed(amount);

  } else if (cmd == "calibrate") {
    int steps = doc["steps"] | 500;
    runMotor(steps);

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

  if (doc.containsKey("pet")) {
    pet.name = doc["pet"]["name"].as<String>();
    pet.dailyAmount = doc["pet"]["dailyAmount"];
    pet.active = doc["pet"]["active"];
  }

  if (doc.containsKey("schedules")) {
    JsonArray arr = doc["schedules"];
    scheduleCount = 0;

    for (JsonObject s : arr) {
      if (scheduleCount >= 10) break;

      schedules[scheduleCount].hour = s["hour"];
      schedules[scheduleCount].minute = s["minute"];
      schedules[scheduleCount].amount = s["amount"];
      schedules[scheduleCount].active = s["active"];

      JsonArray days = s["days"];
      for (int d = 0; d < 7; d++) {
        schedules[scheduleCount].days[d] = days[d];
      }

      scheduleCount++;
    }

    Serial.printf("📅 %d horários configurados\n", scheduleCount);
  }

  if (doc.containsKey("stepsPerGram")) {
    STEPS_PER_GRAM = doc["stepsPerGram"];
    preferences.putFloat("stepsGram", STEPS_PER_GRAM);
  }
}

// ══════════════════════════════════════════════════════════════════
//                    ENVIO DE DADOS
// ══════════════════════════════════════════════════════════════════

void sendStatus(String status) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
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

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_STATUS.c_str(), json.c_str());
}

void sendTelemetry() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["foodLevel"] = foodLevel;
  doc["distance"] = distancia;

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_TELEMETRY.c_str(), json.c_str());

  // Alerta de nível baixo
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

void sendFullStatus() {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["uptime"] = millis() / 1000;
  doc["heap"] = ESP.getFreeHeap();
  doc["rssi"] = WiFi.RSSI();
  doc["foodLevel"] = foodLevel;
  doc["distance"] = distancia;

  JsonObject petObj = doc.createNestedObject("pet");
  petObj["name"] = pet.name;
  petObj["dailyAmount"] = pet.dailyAmount;
  petObj["active"] = pet.active;

  String json;
  serializeJson(doc, json);
  mqtt.publish(TOPIC_STATUS.c_str(), json.c_str());
}

void sendFeedingLog(float amount) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["petName"] = pet.name;
  doc["amount"] = amount;
  doc["timestamp"] = millis();

  String json;
  serializeJson(doc, json);

  String topic = "devices/" + DEVICE_ID + "/feeding";
  mqtt.publish(topic.c_str(), json.c_str());
}

// ══════════════════════════════════════════════════════════════════
//                    CONTROLE DO MOTOR
// ══════════════════════════════════════════════════════════════════

void setupMotor() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  stopMotor();
}

void runMotor(int steps) {
  Serial.printf("🔄 Motor: %d passos\n", steps);

  for (int i = 0; i < steps; i++) {
    // Aplica sequência nos pinos
    digitalWrite(IN1, stepSequence[currentStep][0]);
    digitalWrite(IN2, stepSequence[currentStep][1]);
    digitalWrite(IN3, stepSequence[currentStep][2]);
    digitalWrite(IN4, stepSequence[currentStep][3]);

    currentStep++;
    if (currentStep >= 8) currentStep = 0;

    delayMicroseconds(2000);  // Velocidade do motor
  }

  stopMotor();
}

void stopMotor() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}

void dispenseFeed(float grams) {
  Serial.printf("🍽️ Dispensando %.1fg de ração\n", grams);

  int steps = (int)(grams * STEPS_PER_GRAM);
  runMotor(steps);

  // Registra no servidor
  sendFeedingLog(grams);

  Serial.println("✅ Alimentação completa!");
}

// ══════════════════════════════════════════════════════════════════
//                    SENSOR ULTRASSÔNICO
// ══════════════════════════════════════════════════════════════════

void setupSensor() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void readSensor() {
  // Envia pulso
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Lê resposta
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration > 0) {
    distancia = duration * 0.034 / 2.0;

    // Converte para porcentagem (30cm = vazio, 5cm = cheio)
    foodLevel = constrain(map(distancia, 30, 5, 0, 100), 0, 100);

    Serial.printf("📏 Distância: %.1f cm | Nível: %.0f%%\n", distancia, foodLevel);
  } else {
    Serial.println("⚠️ Erro na leitura do sensor");
  }
}

// ══════════════════════════════════════════════════════════════════
//                    AGENDAMENTO
// ══════════════════════════════════════════════════════════════════

void checkSchedules() {
  // Obtém hora atual (simplificado - sem RTC)
  // Em produção, usar NTP ou RTC DS3231

  // Por enquanto, apenas log
  Serial.println("⏰ Verificando horários...");
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

  STEPS_PER_GRAM = preferences.getFloat("stepsGram", 41.0);

  preferences.end();

  Serial.println("📂 Configuração carregada");
  Serial.printf("   Configurado: %s\n", config.configured ? "Sim" : "Não");
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
  Serial.println("╔═══════════════════════════════════════════╗");
  Serial.println("║     🐾 PetFeeder ESP32 - SaaS Client      ║");
  Serial.println("║         Versão " + FIRMWARE_VERSION + " - Seu Circuito         ║");
  Serial.println("╠═══════════════════════════════════════════╣");
  Serial.println("║  Motor: IN1=16, IN2=17, IN3=18, IN4=19    ║");
  Serial.println("║  Sensor: TRIG=23, ECHO=22                 ║");
  Serial.println("╚═══════════════════════════════════════════╝");
  Serial.println("");
}
