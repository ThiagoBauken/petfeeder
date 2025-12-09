/*
 * PetFeeder ESP32 - Sistema Completo para 3 Gatos
 * Motor: 28BYJ-48 com ULN2003
 * Autor: Sistema Otimizado 2024
 * 
 * Pinagem ESP32:
 * Motor 1 (Gato 1): GPIO 13, 12, 14, 27
 * Motor 2 (Gato 2): GPIO 26, 25, 33, 32  
 * Motor 3 (Gato 3): GPIO 15, 2, 4, 5
 * HC-SR04 1: Trig=19, Echo=18
 * HC-SR04 2: Trig=23, Echo=22
 * HC-SR04 3: Trig=16, Echo=17
 * RTC DS3231: SDA=21, SCL=22 (I2C)
 */

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <RTClib.h>
#include <Wire.h>
#include <Preferences.h>
#include <SPIFFS.h>
#include <time.h>

// ==================== CONFIGURAÇÕES WiFi ====================
const char* ssid = "SUA_REDE_WIFI";
const char* password = "SUA_SENHA";

// Configuração AP Mode (caso WiFi falhe)
const char* ap_ssid = "PetFeeder_Setup";
const char* ap_password = "12345678";

// ==================== CONFIGURAÇÕES DOS MOTORES ====================
// Motor 28BYJ-48 tem 2048 steps por revolução
const int STEPS_PER_REVOLUTION = 2048;
const float STEPS_PER_GRAM = 41.0;  // Calibrar com sua ração

// Pinos Motor 1 (Felix)
const int motor1Pins[] = {13, 12, 14, 27};
// Pinos Motor 2 (Luna)  
const int motor2Pins[] = {26, 25, 33, 32};
// Pinos Motor 3 (Max)
const int motor3Pins[] = {15, 2, 4, 5};

// Sequência de passos para 28BYJ-48 (Half-step)
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

// ==================== CONFIGURAÇÕES SENSORES ====================
// HC-SR04 para nível de ração
const int trigPins[] = {19, 23, 16};
const int echoPins[] = {18, 22, 17};

// ==================== ESTRUTURAS DE DADOS ====================
struct Pet {
  String name;
  float dailyAmount;
  float todayTotal;
  float lastPortion;
  String lastFeedTime;
  bool active;
  int motorIndex;
  int compartment;
};

struct Schedule {
  int hour;
  int minute;
  int petId;  // 0=todos, 1-3=específico
  float amount;
  bool active;
  bool weekdays[7];
  String id;
};

struct SystemStats {
  float levels[3];
  float totalDispensedToday;
  int feedingCount;
  String lastFeedTime;
  float temperature;
  bool wifiConnected;
  unsigned long uptime;
};

// ==================== VARIÁVEIS GLOBAIS ====================
Pet pets[3];
Schedule schedules[10];
SystemStats stats;
RTC_DS3231 rtc;
Preferences preferences;
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Controle dos motores
int currentStep[3] = {0, 0, 0};
bool motorRunning[3] = {false, false, false};
int targetSteps[3] = {0, 0, 0};
int stepDelay = 2; // ms entre steps (velocidade)

// Timers
unsigned long lastSensorRead = 0;
unsigned long lastScheduleCheck = 0;
unsigned long lastStatsUpdate = 0;
unsigned long lastNTPSync = 0;

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== PetFeeder ESP32 Iniciando ===");
  
  // Inicializa SPIFFS
  if (!SPIFFS.begin(true)) {
    Serial.println("Erro ao montar SPIFFS");
  }
  
  // Inicializa Preferences
  preferences.begin("petfeeder", false);
  
  // Configura pinos dos motores
  setupMotors();
  
  // Configura sensores
  setupSensors();
  
  // Inicializa RTC
  if (!rtc.begin()) {
    Serial.println("RTC não encontrado!");
  } else {
    if (rtc.lostPower()) {
      Serial.println("RTC perdeu energia, ajustando...");
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }
  
  // Carrega configurações
  loadConfiguration();
  
  // Conecta WiFi
  connectWiFi();
  
  // Sincroniza horário NTP
  configTime(-3 * 3600, 0, "pool.ntp.org");
  
  // Configura servidor web
  setupWebServer();
  
  // Inicializa pets padrão
  initializePets();
  
  Serial.println("=== Sistema Pronto! ===");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ==================== LOOP PRINCIPAL ====================
void loop() {
  // Processa WebSocket
  ws.cleanupClients();
  
  // Controla motores
  for (int i = 0; i < 3; i++) {
    if (motorRunning[i]) {
      stepMotor(i);
    }
  }
  
  // Lê sensores a cada 5 segundos
  if (millis() - lastSensorRead > 5000) {
    readSensors();
    lastSensorRead = millis();
  }
  
  // Verifica horários a cada minuto
  if (millis() - lastScheduleCheck > 60000) {
    checkSchedules();
    lastScheduleCheck = millis();
  }
  
  // Atualiza estatísticas
  if (millis() - lastStatsUpdate > 1000) {
    updateStats();
    sendStatusUpdate();
    lastStatsUpdate = millis();
  }
  
  // Sincroniza NTP a cada hora
  if (millis() - lastNTPSync > 3600000) {
    configTime(-3 * 3600, 0, "pool.ntp.org");
    lastNTPSync = millis();
  }
  
  delay(1); // Previne watchdog
}

// ==================== FUNÇÕES DOS MOTORES ====================
void setupMotors() {
  for (int m = 0; m < 3; m++) {
    const int* pins = (m == 0) ? motor1Pins : (m == 1) ? motor2Pins : motor3Pins;
    for (int i = 0; i < 4; i++) {
      pinMode(pins[i], OUTPUT);
      digitalWrite(pins[i], LOW);
    }
  }
}

void stepMotor(int motorIndex) {
  if (targetSteps[motorIndex] == 0) {
    stopMotor(motorIndex);
    return;
  }
  
  const int* pins = (motorIndex == 0) ? motor1Pins : 
                    (motorIndex == 1) ? motor2Pins : motor3Pins;
  
  // Aplica sequência de passos
  for (int i = 0; i < 4; i++) {
    digitalWrite(pins[i], stepSequence[currentStep[motorIndex]][i]);
  }
  
  // Avança ou retrocede
  if (targetSteps[motorIndex] > 0) {
    currentStep[motorIndex]++;
    targetSteps[motorIndex]--;
    if (currentStep[motorIndex] >= 8) currentStep[motorIndex] = 0;
  } else {
    currentStep[motorIndex]--;
    targetSteps[motorIndex]++;
    if (currentStep[motorIndex] < 0) currentStep[motorIndex] = 7;
  }
  
  // Verifica se terminou
  if (targetSteps[motorIndex] == 0) {
    stopMotor(motorIndex);
  }
  
  delayMicroseconds(stepDelay * 1000);
}

void stopMotor(int motorIndex) {
  const int* pins = (motorIndex == 0) ? motor1Pins : 
                    (motorIndex == 1) ? motor2Pins : motor3Pins;
  
  for (int i = 0; i < 4; i++) {
    digitalWrite(pins[i], LOW);
  }
  
  motorRunning[motorIndex] = false;
  Serial.printf("Motor %d parado\n", motorIndex + 1);
}

void dispenseFood(int petId, float grams) {
  if (petId < 1 || petId > 3) {
    Serial.println("Pet ID inválido");
    return;
  }
  
  int motorIndex = petId - 1;
  
  if (motorRunning[motorIndex]) {
    Serial.printf("Motor %d já está em execução\n", motorIndex + 1);
    return;
  }
  
  int steps = (int)(grams * STEPS_PER_GRAM);
  
  Serial.printf("Dispensando %.1fg para %s (%d steps)\n", 
                grams, pets[motorIndex].name.c_str(), steps);
  
  targetSteps[motorIndex] = steps;
  motorRunning[motorIndex] = true;
  
  // Atualiza estatísticas
  pets[motorIndex].lastPortion = grams;
  pets[motorIndex].todayTotal += grams;
  pets[motorIndex].lastFeedTime = getCurrentTime();
  stats.totalDispensedToday += grams;
  stats.feedingCount++;
  stats.lastFeedTime = getCurrentTime();
  
  // Salva log
  logFeeding(petId, grams, "manual");
  
  // Notifica clientes
  sendStatusUpdate();
}

void feedAll(float grams) {
  for (int i = 0; i < 3; i++) {
    if (pets[i].active) {
      dispenseFood(i + 1, grams);
      delay(500); // Pequeno delay entre motores
    }
  }
}

// ==================== FUNÇÕES DOS SENSORES ====================
void setupSensors() {
  for (int i = 0; i < 3; i++) {
    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
  }
}

void readSensors() {
  for (int i = 0; i < 3; i++) {
    // Envia pulso ultrassônico
    digitalWrite(trigPins[i], LOW);
    delayMicroseconds(2);
    digitalWrite(trigPins[i], HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPins[i], LOW);
    
    // Lê eco
    long duration = pulseIn(echoPins[i], HIGH, 30000);
    
    if (duration > 0) {
      // Converte para cm
      float distance = duration * 0.034 / 2;
      
      // Converte para percentual (30cm = vazio, 5cm = cheio)
      stats.levels[i] = map(constrain(distance, 5, 30), 30, 5, 0, 100);
    }
  }
  
  // Lê temperatura do RTC
  stats.temperature = rtc.getTemperature();
  
  // Verifica níveis baixos
  checkLowLevels();
}

void checkLowLevels() {
  for (int i = 0; i < 3; i++) {
    if (stats.levels[i] < 20) {
      String msg = "ALERTA: Nível baixo no compartimento ";
      msg += String(i + 1) + " (" + pets[i].name + ") - ";
      msg += String(stats.levels[i]) + "%";
      
      sendNotification(msg);
    }
  }
}

// ==================== HORÁRIOS E AGENDAMENTO ====================
void checkSchedules() {
  DateTime now = rtc.now();
  int currentHour = now.hour();
  int currentMinute = now.minute();
  int currentDay = now.dayOfTheWeek();
  
  for (int i = 0; i < 10; i++) {
    if (!schedules[i].active) continue;
    if (!schedules[i].weekdays[currentDay]) continue;
    
    if (schedules[i].hour == currentHour && 
        schedules[i].minute == currentMinute) {
      
      Serial.printf("Horário de alimentação: %02d:%02d\n", 
                   currentHour, currentMinute);
      
      if (schedules[i].petId == 0) {
        feedAll(schedules[i].amount);
      } else {
        dispenseFood(schedules[i].petId, schedules[i].amount);
      }
      
      // Evita alimentação duplicada no mesmo minuto
      delay(61000);
    }
  }
}

String getCurrentTime() {
  DateTime now = rtc.now();
  char buffer[20];
  sprintf(buffer, "%02d/%02d %02d:%02d", 
          now.day(), now.month(), now.hour(), now.minute());
  return String(buffer);
}

// ==================== CONFIGURAÇÃO E PERSISTÊNCIA ====================
void initializePets() {
  // Pet 1 - Felix
  pets[0].name = preferences.getString("pet1_name", "Felix");
  pets[0].dailyAmount = preferences.getFloat("pet1_daily", 60.0);
  pets[0].active = preferences.getBool("pet1_active", true);
  pets[0].motorIndex = 0;
  pets[0].compartment = 1;
  pets[0].todayTotal = 0;
  
  // Pet 2 - Luna
  pets[1].name = preferences.getString("pet2_name", "Luna");
  pets[1].dailyAmount = preferences.getFloat("pet2_daily", 50.0);
  pets[1].active = preferences.getBool("pet2_active", true);
  pets[1].motorIndex = 1;
  pets[1].compartment = 2;
  pets[1].todayTotal = 0;
  
  // Pet 3 - Max
  pets[2].name = preferences.getString("pet3_name", "Max");
  pets[2].dailyAmount = preferences.getFloat("pet3_daily", 70.0);
  pets[2].active = preferences.getBool("pet3_active", true);
  pets[2].motorIndex = 2;
  pets[2].compartment = 3;
  pets[2].todayTotal = 0;
  
  // Horários padrão se não existirem
  if (!preferences.getBool("configured", false)) {
    setupDefaultSchedules();
    preferences.putBool("configured", true);
  }
}

void setupDefaultSchedules() {
  // Café da manhã - 07:00
  schedules[0].hour = 7;
  schedules[0].minute = 0;
  schedules[0].petId = 0;
  schedules[0].amount = 20.0;
  schedules[0].active = true;
  schedules[0].id = "morning";
  for (int i = 0; i < 7; i++) schedules[0].weekdays[i] = true;
  
  // Almoço - 12:00
  schedules[1].hour = 12;
  schedules[1].minute = 0;
  schedules[1].petId = 0;
  schedules[1].amount = 15.0;
  schedules[1].active = true;
  schedules[1].id = "lunch";
  for (int i = 0; i < 7; i++) schedules[1].weekdays[i] = true;
  
  // Jantar - 19:00
  schedules[2].hour = 19;
  schedules[2].minute = 0;
  schedules[2].petId = 0;
  schedules[2].amount = 25.0;
  schedules[2].active = true;
  schedules[2].id = "dinner";
  for (int i = 0; i < 7; i++) schedules[2].weekdays[i] = true;
  
  saveSchedules();
}

void saveConfiguration() {
  for (int i = 0; i < 3; i++) {
    String key = "pet" + String(i + 1);
    preferences.putString(key + "_name", pets[i].name);
    preferences.putFloat(key + "_daily", pets[i].dailyAmount);
    preferences.putBool(key + "_active", pets[i].active);
  }
  
  saveSchedules();
}

void loadConfiguration() {
  // Carrega schedules salvos
  for (int i = 0; i < 10; i++) {
    String key = "sched" + String(i);
    if (preferences.isKey((key + "_h").c_str())) {
      schedules[i].hour = preferences.getInt(key + "_h");
      schedules[i].minute = preferences.getInt(key + "_m");
      schedules[i].petId = preferences.getInt(key + "_pet");
      schedules[i].amount = preferences.getFloat(key + "_amt");
      schedules[i].active = preferences.getBool(key + "_act");
      schedules[i].id = key;
    }
  }
}

void saveSchedules() {
  for (int i = 0; i < 10; i++) {
    if (schedules[i].active) {
      String key = "sched" + String(i);
      preferences.putInt(key + "_h", schedules[i].hour);
      preferences.putInt(key + "_m", schedules[i].minute);
      preferences.putInt(key + "_pet", schedules[i].petId);
      preferences.putFloat(key + "_amt", schedules[i].amount);
      preferences.putBool(key + "_act", schedules[i].active);
    }
  }
}

// ==================== LOGS E ESTATÍSTICAS ====================
void logFeeding(int petId, float amount, String trigger) {
  // Cria entrada JSON
  StaticJsonDocument<256> doc;
  doc["time"] = getCurrentTime();
  doc["pet"] = petId;
  doc["amount"] = amount;
  doc["trigger"] = trigger;
  
  // Salva em arquivo
  File file = SPIFFS.open("/feeding_log.txt", FILE_APPEND);
  if (file) {
    serializeJson(doc, file);
    file.println();
    file.close();
  }
}

String getFeedingHistory() {
  String history = "[";
  File file = SPIFFS.open("/feeding_log.txt", FILE_READ);
  
  if (file) {
    int count = 0;
    while (file.available() && count < 50) {
      String line = file.readStringUntil('\n');
      if (line.length() > 0) {
        if (count > 0) history += ",";
        history += line;
        count++;
      }
    }
    file.close();
  }
  
  history += "]";
  return history;
}

void updateStats() {
  stats.uptime = millis() / 1000;
  stats.wifiConnected = (WiFi.status() == WL_CONNECTED);
  
  // Reset contadores diários à meia-noite
  DateTime now = rtc.now();
  static int lastDay = now.day();
  
  if (now.day() != lastDay) {
    stats.totalDispensedToday = 0;
    stats.feedingCount = 0;
    for (int i = 0; i < 3; i++) {
      pets[i].todayTotal = 0;
    }
    lastDay = now.day();
  }
}

// ==================== REDE E CONECTIVIDADE ====================
void connectWiFi() {
  Serial.print("Conectando ao WiFi");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFalha no WiFi, criando AP...");
    WiFi.softAP(ap_ssid, ap_password);
    Serial.print("AP IP: ");
    Serial.println(WiFi.softAPIP());
  }
}

void sendNotification(String message) {
  // Implementar Telegram/Email/Push notification
  Serial.println("NOTIFICAÇÃO: " + message);
  
  // Envia via WebSocket
  if (ws.count() > 0) {
    StaticJsonDocument<256> doc;
    doc["type"] = "notification";
    doc["message"] = message;
    doc["level"] = "warning";
    
    String output;
    serializeJson(doc, output);
    ws.textAll(output);
  }
}

// ==================== WEBSOCKET HANDLERS ====================
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, 
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WebSocket cliente #%u conectado\n", client->id());
    sendStatusUpdate();
    
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WebSocket cliente #%u desconectado\n", client->id());
    
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    
    if (info->final && info->index == 0 && info->len == len && 
        info->opcode == WS_TEXT) {
      
      data[len] = 0;
      String message = (char*)data;
      
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, message);
      
      if (!error) {
        handleWebSocketMessage(doc);
      }
    }
  }
}

void handleWebSocketMessage(JsonDocument& doc) {
  String action = doc["action"];
  
  if (action == "feed") {
    int petId = doc["petId"];
    float amount = doc["amount"] | 20.0;
    
    if (petId == 0) {
      feedAll(amount);
    } else {
      dispenseFood(petId, amount);
    }
    
  } else if (action == "updatePet") {
    int petId = doc["petId"];
    if (petId >= 1 && petId <= 3) {
      pets[petId-1].name = doc["name"].as<String>();
      pets[petId-1].dailyAmount = doc["dailyAmount"];
      pets[petId-1].active = doc["active"];
      saveConfiguration();
    }
    
  } else if (action == "updateSchedule") {
    int schedId = doc["schedId"];
    if (schedId >= 0 && schedId < 10) {
      schedules[schedId].hour = doc["hour"];
      schedules[schedId].minute = doc["minute"];
      schedules[schedId].petId = doc["petId"];
      schedules[schedId].amount = doc["amount"];
      schedules[schedId].active = doc["active"];
      saveSchedules();
    }
    
  } else if (action == "getStatus") {
    sendStatusUpdate();
    
  } else if (action == "getHistory") {
    sendHistory();
    
  } else if (action == "calibrate") {
    int motorId = doc["motorId"];
    int steps = doc["steps"];
    if (motorId >= 1 && motorId <= 3) {
      targetSteps[motorId-1] = steps;
      motorRunning[motorId-1] = true;
    }
  }
}

void sendStatusUpdate() {
  if (ws.count() == 0) return;
  
  StaticJsonDocument<1024> doc;
  doc["type"] = "status";
  doc["wifi"] = stats.wifiConnected;
  doc["temperature"] = stats.temperature;
  doc["uptime"] = stats.uptime;
  doc["totalToday"] = stats.totalDispensedToday;
  doc["feedingCount"] = stats.feedingCount;
  doc["lastFeed"] = stats.lastFeedTime;
  
  // Níveis
  JsonArray levels = doc.createNestedArray("levels");
  for (int i = 0; i < 3; i++) {
    levels.add(stats.levels[i]);
  }
  
  // Pets
  JsonArray petsArray = doc.createNestedArray("pets");
  for (int i = 0; i < 3; i++) {
    JsonObject pet = petsArray.createNestedObject();
    pet["id"] = i + 1;
    pet["name"] = pets[i].name;
    pet["daily"] = pets[i].dailyAmount;
    pet["today"] = pets[i].todayTotal;
    pet["lastPortion"] = pets[i].lastPortion;
    pet["lastFeed"] = pets[i].lastFeedTime;
    pet["active"] = pets[i].active;
  }
  
  String