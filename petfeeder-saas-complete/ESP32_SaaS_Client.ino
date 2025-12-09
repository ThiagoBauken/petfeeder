/*
 * PetFeeder ESP32 - Cliente SaaS
 * Conecta ao servidor central via MQTT
 * Suporta múltiplos dispositivos
 * 
 * CONFIGURAÇÃO INICIAL:
 * 1. Configure WiFi (linhas 35-36)
 * 2. Configure servidor MQTT (linha 39)
 * 3. O DEVICE_ID é gerado automaticamente baseado no MAC
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <RTClib.h>
#include <Update.h>
#include <ESPmDNS.h>

// ==================== IDENTIFICAÇÃO ÚNICA DO DISPOSITIVO ====================
String DEVICE_ID = "";  // Será gerado baseado no MAC address
String USER_TOKEN = ""; // Token do usuário (configurado via portal)
const String FIRMWARE_VERSION = "1.0.0";
const String DEVICE_TYPE = "PETFEEDER_V1";

// ==================== CONFIGURAÇÃO DO SERVIDOR CENTRAL ====================
const char* MQTT_SERVER = "seu-servidor.com.br";  // <-- ALTERE AQUI
const int MQTT_PORT = 1883;
const char* MQTT_USER = ""; // Será preenchido após registro
const char* MQTT_PASS = ""; // Será preenchido após registro

// API Endpoints
const String API_BASE_URL = "https://seu-servidor.com.br/api/v1";  // <-- ALTERE AQUI
const String API_REGISTER = "/devices/register";
const String API_AUTH = "/devices/auth";
const String API_STATUS = "/devices/status";
const String API_OTA = "/devices/firmware";

// ==================== CONFIGURAÇÃO WIFI ====================
const char* wifi_ssid = "SUA_REDE_WIFI";  // <-- ALTERE AQUI
const char* wifi_password = "SUA_SENHA";   // <-- ALTERE AQUI

// AP Mode para configuração inicial
const char* ap_ssid_prefix = "PetFeeder_";
bool isConfigMode = false;

// ==================== MOTOR 28BYJ-48 CONFIGURAÇÃO ====================
const int STEPS_PER_REVOLUTION = 2048;
float STEPS_PER_GRAM = 41.0;  // Valor padrão, será atualizado do servidor

// Pinos dos Motores (3 motores para 3 gatos)
const int motor1Pins[] = {13, 12, 14, 27};
const int motor2Pins[] = {26, 25, 33, 32};
const int motor3Pins[] = {15, 2, 4, 5};

// Sequência Half-Step
const int stepSequence[8][4] = {
  {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0},
  {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}
};

// ==================== SENSORES ====================
const int trigPins[] = {19, 23, 16};
const int echoPins[] = {18, 22, 17};

// ==================== OBJETOS GLOBAIS ====================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Preferences preferences;
RTC_DS3231 rtc;
HTTPClient http;

// ==================== ESTRUTURAS DE DADOS ====================
struct DeviceConfig {
  String userId;
  String deviceName;
  int timezone;
  bool registered;
  String mqttUser;
  String mqttPass;
  String authToken;
};

struct Pet {
  String id;
  String name;
  float dailyAmount;
  float dispensed;
  int compartment;
  bool active;
};

struct Schedule {
  String id;
  int hour;
  int minute;
  int petIndex;
  float amount;
  bool active;
  bool days[7];
};

// ==================== VARIÁVEIS GLOBAIS ====================
DeviceConfig deviceConfig;
Pet pets[3];
Schedule schedules[10];
int scheduleCount = 0;

// Status do Sistema
float foodLevels[3] = {0, 0, 0};
float temperature = 0;
bool motorRunning[3] = {false, false, false};
int targetSteps[3] = {0, 0, 0};
int currentStep[3] = {0, 0, 0};

// Controle de tempo
unsigned long lastHeartbeat = 0;
unsigned long lastSensorRead = 0;
unsigned long lastScheduleCheck = 0;
unsigned long lastReconnectAttempt = 0;

// Tópicos MQTT dinâmicos (baseados no DEVICE_ID)
String MQTT_TOPIC_COMMAND = "";
String MQTT_TOPIC_STATUS = "";
String MQTT_TOPIC_TELEMETRY = "";
String MQTT_TOPIC_CONFIG = "";
String MQTT_TOPIC_ALERT = "";

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║     PetFeeder SaaS Client v1.0       ║");
  Serial.println("╚══════════════════════════════════════╝");
  
  // Gera Device ID único baseado no MAC
  generateDeviceId();
  
  // Inicializa Preferences
  preferences.begin("petfeeder", false);
  loadDeviceConfig();
  
  // Configura Hardware
  setupMotors();
  setupSensors();
  setupRTC();
  
  // Conecta WiFi
  if (!connectWiFi()) {
    startConfigPortal();
  }
  
  // Se não está registrado, faz o registro
  if (!deviceConfig.registered) {
    if (!registerDevice()) {
      Serial.println("❌ Falha no registro. Modo config ativado.");
      startConfigPortal();
    }
  }
  
  // Configura MQTT
  setupMQTT();
  
  // Conecta ao servidor
  connectToServer();
  
  Serial.println("✅ Sistema iniciado com sucesso!");
  Serial.println("Device ID: " + DEVICE_ID);
}

// ==================== LOOP PRINCIPAL ====================
void loop() {
  // Mantém conexão MQTT
  if (!mqttClient.connected()) {
    if (millis() - lastReconnectAttempt > 5000) {
      reconnectMQTT();
      lastReconnectAttempt = millis();
    }
  }
  mqttClient.loop();
  
  // Controle dos Motores
  for (int i = 0; i < 3; i++) {
    if (motorRunning[i]) {
      stepMotor(i);
    }
  }
  
  // Envia heartbeat a cada 30 segundos
  if (millis() - lastHeartbeat > 30000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  
  // Lê sensores a cada 5 segundos
  if (millis() - lastSensorRead > 5000) {
    readSensors();
    sendTelemetry();
    lastSensorRead = millis();
  }
  
  // Verifica schedules a cada minuto
  if (millis() - lastScheduleCheck > 60000) {
    checkSchedules();
    lastScheduleCheck = millis();
  }
  
  // Processa portal de configuração se ativo
  if (isConfigMode) {
    handleConfigPortal();
  }
  
  delay(1);
}

// ==================== IDENTIFICAÇÃO E REGISTRO ====================
void generateDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  
  DEVICE_ID = "PF_";
  for (int i = 0; i < 6; i++) {
    if (mac[i] < 0x10) DEVICE_ID += "0";
    DEVICE_ID += String(mac[i], HEX);
  }
  DEVICE_ID.toUpperCase();
  
  // Atualiza tópicos MQTT
  MQTT_TOPIC_COMMAND = "devices/" + DEVICE_ID + "/command";
  MQTT_TOPIC_STATUS = "devices/" + DEVICE_ID + "/status";
  MQTT_TOPIC_TELEMETRY = "devices/" + DEVICE_ID + "/telemetry";
  MQTT_TOPIC_CONFIG = "devices/" + DEVICE_ID + "/config";
  MQTT_TOPIC_ALERT = "devices/" + DEVICE_ID + "/alert";
}

bool registerDevice() {
  Serial.println("📝 Registrando dispositivo no servidor...");
  
  HTTPClient http;
  http.begin(API_BASE_URL + API_REGISTER);
  http.addHeader("Content-Type", "application/json");
  
  // Prepara dados de registro
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["deviceType"] = DEVICE_TYPE;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["macAddress"] = WiFi.macAddress();
  doc["ipAddress"] = WiFi.localIP().toString();
  
  JsonObject capabilities = doc.createNestedObject("capabilities");
  capabilities["motors"] = 3;
  capabilities["sensors"] = 3;
  capabilities["rtc"] = true;
  capabilities["ota"] = true;
  
  String requestBody;
  serializeJson(doc, requestBody);
  
  int httpCode = http.POST(requestBody);
  
  if (httpCode == 200) {
    String response = http.getString();
    StaticJsonDocument<512> responseDoc;
    deserializeJson(responseDoc, response);
    
    // Salva credenciais
    deviceConfig.mqttUser = responseDoc["mqttUser"].as<String>();
    deviceConfig.mqttPass = responseDoc["mqttPass"].as<String>();
    deviceConfig.authToken = responseDoc["authToken"].as<String>();
    deviceConfig.userId = responseDoc["userId"].as<String>();
    deviceConfig.registered = true;
    
    saveDeviceConfig();
    
    Serial.println("✅ Dispositivo registrado com sucesso!");
    Serial.println("User ID: " + deviceConfig.userId);
    return true;
  } else {
    Serial.printf("❌ Erro no registro. HTTP Code: %d\n", httpCode);
    return false;
  }
  
  http.end();
}

// ==================== MQTT ====================
void setupMQTT() {
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(2048);  // Buffer maior para mensagens grandes
}

bool reconnectMQTT() {
  Serial.print("🔄 Conectando ao MQTT...");
  
  String clientId = DEVICE_ID + "_" + String(random(0xffff), HEX);
  
  // Prepara mensagem de Last Will
  StaticJsonDocument<256> willDoc;
  willDoc["deviceId"] = DEVICE_ID;
  willDoc["status"] = "offline";
  willDoc["timestamp"] = millis();
  
  String willMessage;
  serializeJson(willDoc, willMessage);
  
  if (mqttClient.connect(clientId.c_str(), 
                        deviceConfig.mqttUser.c_str(),
                        deviceConfig.mqttPass.c_str(),
                        MQTT_TOPIC_STATUS.c_str(),
                        1, true, willMessage.c_str())) {
    
    Serial.println(" ✅ Conectado!");
    
    // Subscreve aos tópicos
    mqttClient.subscribe(MQTT_TOPIC_COMMAND.c_str(), 1);
    mqttClient.subscribe(MQTT_TOPIC_CONFIG.c_str(), 1);
    mqttClient.subscribe(("devices/" + DEVICE_ID + "/ota").c_str(), 1);
    
    // Envia status online
    sendStatus("online");
    
    // Solicita configuração atualizada
    requestConfig();
    
    return true;
  }
  
  Serial.printf(" ❌ Falha, rc=%d\n", mqttClient.state());
  return false;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = "";
  
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.println("📨 MQTT Recebido:");
  Serial.println("  Tópico: " + topicStr);
  Serial.println("  Mensagem: " + message);
  
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.println("❌ Erro ao parsear JSON");
    return;
  }
  
  // Processa comandos
  if (topicStr == MQTT_TOPIC_COMMAND) {
    handleCommand(doc);
  }
  // Processa configuração
  else if (topicStr == MQTT_TOPIC_CONFIG) {
    handleConfig(doc);
  }
  // Processa OTA
  else if (topicStr.endsWith("/ota")) {
    handleOTA(doc);
  }
}

void handleCommand(JsonDocument& doc) {
  String cmd = doc["command"];
  String cmdId = doc["id"];  // ID do comando para confirmação
  
  Serial.println("⚡ Comando: " + cmd);
  
  bool success = false;
  String result = "";
  
  if (cmd == "feed") {
    int petIndex = doc["petIndex"];
    float amount = doc["amount"];
    success = dispenseFeed(petIndex, amount);
    result = success ? "Alimentação iniciada" : "Erro ao alimentar";
    
  } else if (cmd == "feedAll") {
    float amount = doc["amount"] | 20.0;
    for (int i = 0; i < 3; i++) {
      if (pets[i].active) {
        dispenseFeed(i, amount);
      }
    }
    success = true;
    result = "Todos alimentados";
    
  } else if (cmd == "calibrate") {
    int motor = doc["motor"];
    int steps = doc["steps"];
    success = calibrateMotor(motor, steps);
    result = "Calibração " + String(success ? "completa" : "falhou");
    
  } else if (cmd == "restart") {
    success = true;
    result = "Reiniciando...";
    sendCommandResponse(cmdId, success, result);
    delay(1000);
    ESP.restart();
    
  } else if (cmd == "factoryReset") {
    preferences.clear();
    success = true;
    result = "Reset de fábrica executado";
    sendCommandResponse(cmdId, success, result);
    delay(1000);
    ESP.restart();
    
  } else if (cmd == "updateSchedule") {
    updateSchedulesFromServer(doc["schedules"]);
    success = true;
    result = "Horários atualizados";
    
  } else if (cmd == "updatePets") {
    updatePetsFromServer(doc["pets"]);
    success = true;
    result = "Pets atualizados";
    
  } else if (cmd == "getStatus") {
    sendFullStatus();
    success = true;
    result = "Status enviado";
    
  } else if (cmd == "getLogs") {
    sendLogs();
    success = true;
    result = "Logs enviados";
  }
  
  // Envia confirmação do comando
  sendCommandResponse(cmdId, success, result);
}

void handleConfig(JsonDocument& doc) {
  Serial.println("⚙️ Atualizando configuração...");
  
  // Atualiza configuração do dispositivo
  if (doc.containsKey("deviceName")) {
    deviceConfig.deviceName = doc["deviceName"].as<String>();
  }
  
  if (doc.containsKey("timezone")) {
    deviceConfig.timezone = doc["timezone"];
  }
  
  if (doc.containsKey("stepsPerGram")) {
    STEPS_PER_GRAM = doc["stepsPerGram"];
    preferences.putFloat("stepsPerGram", STEPS_PER_GRAM);
  }
  
  // Atualiza pets
  if (doc.containsKey("pets")) {
    updatePetsFromServer(doc["pets"]);
  }
  
  // Atualiza schedules
  if (doc.containsKey("schedules")) {
    updateSchedulesFromServer(doc["schedules"]);
  }
  
  saveDeviceConfig();
  
  // Confirma recebimento
  sendConfigAck();
}

// ==================== CONTROLE DOS MOTORES ====================
void setupMotors() {
  for (int m = 0; m < 3; m++) {
    const int* pins = getMotorPins(m);
    for (int i = 0; i < 4; i++) {
      pinMode(pins[i], OUTPUT);
      digitalWrite(pins[i], LOW);
    }
  }
}

const int* getMotorPins(int motor) {
  switch(motor) {
    case 0: return motor1Pins;
    case 1: return motor2Pins;
    case 2: return motor3Pins;
    default: return motor1Pins;
  }
}

bool dispenseFeed(int petIndex, float amount) {
  if (petIndex < 0 || petIndex >= 3) {
    Serial.println("❌ Índice de pet inválido");
    return false;
  }
  
  if (motorRunning[petIndex]) {
    Serial.println("⚠️ Motor já em execução");
    return false;
  }
  
  int steps = (int)(amount * STEPS_PER_GRAM);
  
  Serial.printf("🍽️ Dispensando %.1fg para %s (%d steps)\n", 
                amount, pets[petIndex].name.c_str(), steps);
  
  targetSteps[petIndex] = steps;
  motorRunning[petIndex] = true;
  
  // Registra no servidor
  logFeeding(petIndex, amount, "manual");
  
  // Atualiza estatísticas locais
  pets[petIndex].dispensed += amount;
  
  return true;
}

void stepMotor(int motorIndex) {
  if (targetSteps[motorIndex] == 0) {
    stopMotor(motorIndex);
    return;
  }
  
  const int* pins = getMotorPins(motorIndex);
  
  // Aplica sequência
  for (int i = 0; i < 4; i++) {
    digitalWrite(pins[i], stepSequence[currentStep[motorIndex]][i]);
  }
  
  // Avança passo
  if (targetSteps[motorIndex] > 0) {
    currentStep[motorIndex]++;
    targetSteps[motorIndex]--;
    if (currentStep[motorIndex] >= 8) currentStep[motorIndex] = 0;
  } else {
    currentStep[motorIndex]--;
    targetSteps[motorIndex]++;
    if (currentStep[motorIndex] < 0) currentStep[motorIndex] = 7;
  }
  
  delayMicroseconds(2000);  // Velocidade do motor
}

void stopMotor(int motorIndex) {
  const int* pins = getMotorPins(motorIndex);
  
  for (int i = 0; i < 4; i++) {
    digitalWrite(pins[i], LOW);
  }
  
  motorRunning[motorIndex] = false;
  
  // Notifica servidor que alimentação terminou
  sendFeedingComplete(motorIndex);
}

bool calibrateMotor(int motor, int steps) {
  if (motor < 0 || motor >= 3) return false;
  
  targetSteps[motor] = steps;
  motorRunning[motor] = true;
  
  return true;
}

// ==================== SENSORES ====================
void setupSensors() {
  for (int i = 0; i < 3; i++) {
    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
  }
}

void readSensors() {
  // Lê níveis de ração
  for (int i = 0; i < 3; i++) {
    digitalWrite(trigPins[i], LOW);
    delayMicroseconds(2);
    digitalWrite(trigPins[i], HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPins[i], LOW);
    
    long duration = pulseIn(echoPins[i], HIGH, 30000);
    
    if (duration > 0) {
      float distance = duration * 0.034 / 2;
      // Converte para % (30cm = vazio, 5cm = cheio)
      foodLevels[i] = constrain(map(distance, 30, 5, 0, 100), 0, 100);
    }
  }
  
  // Lê temperatura
  if (rtc.begin()) {
    temperature = rtc.getTemperature();
  }
  
  // Verifica níveis baixos
  for (int i = 0; i < 3; i++) {
    if (foodLevels[i] < 20 && pets[i].active) {
      sendAlert("low_food", i, foodLevels[i]);
    }
  }
}

void setupRTC() {
  if (!rtc.begin()) {
    Serial.println("⚠️ RTC não encontrado");
  } else {
    if (rtc.lostPower()) {
      Serial.println("🔧 Ajustando RTC...");
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }
}

// ==================== SCHEDULES ====================
void checkSchedules() {
  DateTime now = rtc.now();
  int currentHour = now.hour();
  int currentMinute = now.minute();
  int currentDay = now.dayOfTheWeek();
  
  for (int i = 0; i < scheduleCount; i++) {
    if (!schedules[i].active) continue;
    if (!schedules[i].days[currentDay]) continue;
    
    if (schedules[i].hour == currentHour && 
        schedules[i].minute == currentMinute) {
      
      Serial.printf("⏰ Horário de alimentação: %02d:%02d\n", 
                   currentHour, currentMinute);
      
      dispenseFeed(schedules[i].petIndex, schedules[i].amount);
      
      // Evita trigger duplo
      delay(61000);
    }
  }
}

void updateSchedulesFromServer(JsonArray schedulesArray) {
  scheduleCount = 0;
  
  for (JsonObject schedule : schedulesArray) {
    if (scheduleCount >= 10) break;
    
    schedules[scheduleCount].id = schedule["id"].as<String>();
    schedules[scheduleCount].hour = schedule["hour"];
    schedules[scheduleCount].minute = schedule["minute"];
    schedules[scheduleCount].petIndex = schedule["petIndex"];
    schedules[scheduleCount].amount = schedule["amount"];
    schedules[scheduleCount].active = schedule["active"];
    
    JsonArray days = schedule["days"];
    for (int d = 0; d < 7; d++) {
      schedules[scheduleCount].days[d] = days[d];
    }
    
    scheduleCount++;
  }
  
  Serial.printf("📅 %d horários configurados\n", scheduleCount);
}

void updatePetsFromServer(JsonArray petsArray) {
  int index = 0;
  
  for (JsonObject pet : petsArray) {
    if (index >= 3) break;
    
    pets[index].id = pet["id"].as<String>();
    pets[index].name = pet["name"].as<String>();
    pets[index].dailyAmount = pet["dailyAmount"];
    pets[index].compartment = pet["compartment"];
    pets[index].active = pet["active"];
    
    index++;
  }
  
  Serial.printf("🐾 %d pets configurados\n", index);
}

// ==================== COMUNICAÇÃO COM SERVIDOR ====================
void sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000;
  doc["rssi"] = WiFi.RSSI();
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_STATUS.c_str(), message.c_str());
}

void sendTelemetry() {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = millis();
  
  JsonArray levels = doc.createNestedArray("foodLevels");
  for (int i = 0; i < 3; i++) {
    levels.add(foodLevels[i]);
  }
  
  doc["temperature"] = temperature;
  
  JsonArray motors = doc.createNestedArray("motorsRunning");
  for (int i = 0; i < 3; i++) {
    motors.add(motorRunning[i]);
  }
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_TELEMETRY.c_str(), message.c_str(), false);
}

void sendStatus(String status) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["timestamp"] = millis();
  doc["ip"] = WiFi.localIP().toString();
  doc["firmware"] = FIRMWARE_VERSION;
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_STATUS.c_str(), message.c_str(), true);
}

void sendFullStatus() {
  StaticJsonDocument<1024> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = millis();
  
  JsonObject device = doc.createNestedObject("device");
  device["name"] = deviceConfig.deviceName;
  device["firmware"] = FIRMWARE_VERSION;
  device["uptime"] = millis() / 1000;
  device["freeHeap"] = ESP.getFreeHeap();
  device["rssi"] = WiFi.RSSI();
  
  JsonArray levels = doc.createNestedArray("foodLevels");
  for (int i = 0; i < 3; i++) {
    JsonObject level = levels.createNestedObject();
    level["compartment"] = i + 1;
    level["percentage"] = foodLevels[i];
    level["petName"] = pets[i].name;
  }
  
  JsonArray petsStatus = doc.createNestedArray("pets");
  for (int i = 0; i < 3; i++) {
    JsonObject pet = petsStatus.createNestedObject();
    pet["name"] = pets[i].name;
    pet["dispensedToday"] = pets[i].dispensed;
    pet["dailyTarget"] = pets[i].dailyAmount;
    pet["active"] = pets[i].active;
  }
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_STATUS.c_str(), message.c_str());
}

void sendCommandResponse(String cmdId, bool success, String result) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["commandId"] = cmdId;
  doc["success"] = success;
  doc["result"] = result;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  
  String topic = "devices/" + DEVICE_ID + "/response";
  mqttClient.publish(topic.c_str(), message.c_str());
}

void sendAlert(String type, int compartment, float value) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["type"] = type;
  doc["compartment"] = compartment;
  doc["value"] = value;
  doc["petName"] = pets[compartment].name;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_ALERT.c_str(), message.c_str());
}

void sendFeedingComplete(int motorIndex) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["event"] = "feeding_complete";
  doc["petIndex"] = motorIndex;
  doc["petName"] = pets[motorIndex].name;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  
  mqttClient.publish(MQTT_TOPIC_STATUS.c_str(), message.c_str());
}

void logFeeding(int petIndex, float amount, String trigger) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["petIndex"] = petIndex;
  doc["petName"] = pets[petIndex].name;
  doc["amount"] = amount;
  doc["trigger"] = trigger;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  
  String topic = "devices/" + DEVICE_ID + "/feeding";
  mqttClient.publish(topic.c_str(), message.c_str());
}

void sendLogs() {
  // Implementar envio de logs armazenados
  Serial.println("📋 Enviando logs...");
}

void sendConfigAck() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["ack"] = true;
  doc["timestamp"] = millis();
  
  String message;
  serializeJson(doc, message);
  
  String topic = "devices/" + DEVICE_ID + "/config_ack";
  mqttClient.publish(topic.c_str(), message.c_str());
}

void requestConfig() {
  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["request"] = "config";
  
  String message;
  serializeJson(doc, message);
  
  String topic = "server/requests";
  mqttClient.publish(topic.c_str(), message.c_str());
}

void connectToServer() {
  if (connectWiFi()) {
    if (mqttClient.connected() || reconnectMQTT()) {
      Serial.println("✅ Conectado ao servidor!");
    }
  }
}

// ==================== OTA UPDATE ====================
void handleOTA(JsonDocument& doc) {
  String url = doc["url"];
  String version = doc["version"];
  String checksum = doc["checksum"];
  
  Serial.println("🔄 Atualização OTA disponível");
  Serial.println("  Versão: " + version);
  Serial.println("  URL: " + url);
  
  // Envia status de início
  sendOTAStatus("downloading", 0);
  
  HTTPClient http;
  http.begin(url);
  http.addHeader("Authorization", "Bearer " + deviceConfig.authToken);
  
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    int contentLength = http.getSize();
    bool canBegin = Update.begin(contentLength);
    
    if (canBegin) {
      WiFiClient* stream = http.getStreamPtr();
      size_t written = Update.writeStream(*stream);
      
      if (written == contentLength) {
        Serial.println("✅ Download completo");
        sendOTAStatus("installing", 100);
        
        if (Update.end()) {
          if (Update.isFinished()) {
            Serial.println("✅ Atualização instalada! Reiniciando...");
            sendOTAStatus("complete", 100);
            delay(1000);
            ESP.restart();
          }
        }
      }
    }
  } else {
    Serial.printf("❌ Erro OTA: HTTP %d\n", httpCode);
    sendOTAStatus("error", 0);
  }
  
  http.end();
}

void sendOTAStatus(String status, int progress) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["progress"] = progress;
  
  String message;
  serializeJson(doc, message);
  
  String topic = "devices/" + DEVICE_ID + "/ota_status";
  mqttClient.publish(topic.c_str(), message.c_str());
}

// ==================== PORTAL DE CONFIGURAÇÃO ====================
void startConfigPortal() {
  Serial.println("📱 Iniciando portal de configuração...");
  
  isConfigMode = true;
  
  // Cria AP
  String apName = String(ap_ssid_prefix) + DEVICE_ID.substring(3, 9);
  WiFi.softAP(apName.c_str(), "12345678");
  
  Serial.println("📡 Access Point criado:");
  Serial.println("  SSID: " + apName);
  Serial.println("  Senha: 12345678");
  Serial.println("  IP: " + WiFi.softAPIP().toString());
}

void handleConfigPortal() {
  // Implementar servidor web para configuração
  // Permite configurar:
  // - WiFi SSID e senha
  // - Token do usuário
  // - Servidor MQTT
}

// ==================== WiFi ====================
bool connectWiFi() {
  Serial.print("📶 Conectando WiFi");
  WiFi.begin(wifi_ssid, wifi_password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" ✅");
    Serial.println("  IP: " + WiFi.localIP().toString());
    Serial.println("  RSSI: " + String(WiFi.RSSI()) + " dBm");
    return true;
  }
  
  Serial.println(" ❌");
  return false;
}

// ==================== PERSISTÊNCIA ====================
void saveDeviceConfig() {
  preferences.putString("userId", deviceConfig.userId);
  preferences.putString("deviceName", deviceConfig.deviceName);
  preferences.putInt("timezone", deviceConfig.timezone);
  preferences.putBool("registered", deviceConfig.registered);
  preferences.putString("mqttUser", deviceConfig.mqttUser);
  preferences.putString("mqttPass", deviceConfig.mqttPass);
  preferences.putString("authToken", deviceConfig.authToken);
}

void loadDeviceConfig() {
  deviceConfig.userId = preferences.getString("userId", "");
  deviceConfig.deviceName = preferences.getString("deviceName", "PetFeeder");
  deviceConfig.timezone = preferences.getInt("timezone", -3);
  deviceConfig.registered = preferences.getBool("registered", false);
  deviceConfig.mqttUser = preferences.getString("mqttUser", "");
  deviceConfig.mqttPass = preferences.getString("mqttPass", "");
  deviceConfig.authToken = preferences.getString("authToken", "");
  
  STEPS_PER_GRAM = preferences.getFloat("stepsPerGram", 41.0);
}
