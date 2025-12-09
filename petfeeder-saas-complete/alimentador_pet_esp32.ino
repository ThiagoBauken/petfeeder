/*
 * Sistema de Alimentador Automático para Múltiplos Pets
 * Versão: 2.0
 * Plataforma: ESP32
 * Autor: Sistema Customizado para 3 Gatos
 * 
 * Funcionalidades:
 * - Interface Web responsiva
 * - Múltiplos horários programáveis
 * - Controle de porções personalizadas
 * - Monitoramento de nível de ração
 * - Logs de alimentação
 * - Controle manual remoto
 * - Notificações (futuro: Telegram/WhatsApp)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <RTClib.h>
#include <Wire.h>
#include <NewPing.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <NTPClient.h>
#include <WiFiUdp.h>

// =============== CONFIGURAÇÕES DE REDE ===============
const char* ssid = "SEU_WIFI_AQUI";
const char* password = "SUA_SENHA_AQUI";

// Configuração do servidor NTP para sincronização de horário
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -3 * 3600, 60000); // GMT-3 (Brasil)

// =============== DEFINIÇÕES DE PINOS ===============
// Servos para dispensação (3 compartimentos para 3 gatos)
#define SERVO_1_PIN 13  // Servo compartimento gato 1
#define SERVO_2_PIN 12  // Servo compartimento gato 2
#define SERVO_3_PIN 14  // Servo compartimento gato 3

// Sensores ultrassônicos para nível de ração
#define TRIG_PIN_1 25   // Sensor nível compartimento 1
#define ECHO_PIN_1 26
#define TRIG_PIN_2 27   // Sensor nível compartimento 2
#define ECHO_PIN_2 32
#define TRIG_PIN_3 33   // Sensor nível compartimento 3
#define ECHO_PIN_3 35

// Sensores de presença (PIR) - opcional
#define PIR_1 34        // Detecta presença gato 1
#define PIR_2 39        // Detecta presença gato 2
#define PIR_3 36        // Detecta presença gato 3

// LEDs indicadores
#define LED_WIFI 2      // LED azul - Status WiFi
#define LED_FEED 4      // LED verde - Alimentando
#define LED_ALERT 5     // LED vermelho - Alerta

// Buzzer para avisos
#define BUZZER_PIN 15

// =============== OBJETOS E VARIÁVEIS GLOBAIS ===============
Servo servo1, servo2, servo3;
RTC_DS3231 rtc;
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Preferences preferences;

// Sensores ultrassônicos
NewPing sonar1(TRIG_PIN_1, ECHO_PIN_1, 30);
NewPing sonar2(TRIG_PIN_2, ECHO_PIN_2, 30);
NewPing sonar3(TRIG_PIN_3, ECHO_PIN_3, 30);

// =============== ESTRUTURAS DE DADOS ===============
struct PetProfile {
  String name;
  float dailyAmount;      // Quantidade diária em gramas
  int mealsPerDay;        // Número de refeições por dia
  float portionSize;      // Tamanho da porção em gramas
  bool isActive;
  int color;             // Cor no dashboard (RGB)
};

struct FeedingSchedule {
  int hour;
  int minute;
  int petId;             // 0=todos, 1=gato1, 2=gato2, 3=gato3
  float amount;          // Quantidade em gramas
  bool isActive;
  bool weekdays[7];      // Dom=0, Seg=1, ..., Sáb=6
};

struct FeedingLog {
  String timestamp;
  int petId;
  float amountDispensed;
  String triggerType;    // "scheduled", "manual", "presence"
};

struct SystemStatus {
  float level1, level2, level3;  // Níveis de ração em %
  float totalDispensedToday;
  int lastFeedingHour;
  int lastFeedingMinute;
  bool wifiConnected;
  bool rtcSynced;
  float temperature;      // Temperatura do RTC
  int uptime;
};

// Arrays de configuração
PetProfile pets[3];
FeedingSchedule schedules[20];  // Até 20 horários programados
FeedingLog feedingHistory[100]; // Últimos 100 registros
int historyIndex = 0;
SystemStatus systemStatus;

// Variáveis de controle
unsigned long lastCheck = 0;
unsigned long lastNTPSync = 0;
unsigned long lastSensorRead = 0;
bool feedingInProgress = false;
int manualFeedRequest = -1;  // -1=none, 0=all, 1-3=specific pet

// =============== CONFIGURAÇÕES DOS SERVOS ===============
const int servoOpenAngle[3] = {0, 0, 0};        // Ângulos de abertura
const int servoCloseAngle[3] = {90, 90, 90};    // Ângulos de fechamento
const int servoSpeed = 15;                       // Velocidade de movimento

// Calibração: tempo de abertura para dispensar quantidade (ms por grama)
const float msPerGram[3] = {100, 100, 100};      // Ajustar conforme teste

// =============== FUNÇÕES DE CONFIGURAÇÃO ===============
void setup() {
  Serial.begin(115200);
  Serial.println("=== SISTEMA DE ALIMENTADOR AUTOMÁTICO INICIANDO ===");
  
  // Inicializa LEDs
  pinMode(LED_WIFI, OUTPUT);
  pinMode(LED_FEED, OUTPUT);
  pinMode(LED_ALERT, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Inicializa sensores PIR
  pinMode(PIR_1, INPUT);
  pinMode(PIR_2, INPUT);
  pinMode(PIR_3, INPUT);
  
  // LED de inicialização
  blinkLED(LED_WIFI, 3, 200);
  
  // Inicializa SPIFFS para arquivos web
  if(!SPIFFS.begin(true)){
    Serial.println("Erro ao montar SPIFFS");
    blinkLED(LED_ALERT, 5, 100);
  }
  
  // Inicializa Preferences (EEPROM)
  preferences.begin("feeder", false);
  loadConfiguration();
  
  // Inicializa Servos
  servo1.attach(SERVO_1_PIN);
  servo2.attach(SERVO_2_PIN);
  servo3.attach(SERVO_3_PIN);
  closeAllServos();
  
  // Inicializa RTC
  if (!rtc.begin()) {
    Serial.println("RTC não encontrado!");
    blinkLED(LED_ALERT, 10, 100);
  } else {
    systemStatus.rtcSynced = true;
    if (rtc.lostPower()) {
      Serial.println("RTC perdeu energia, ajustando hora...");
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }
  
  // Conecta WiFi
  connectWiFi();
  
  // Sincroniza horário via NTP
  timeClient.begin();
  syncTimeNTP();
  
  // Configura servidor web e websocket
  setupWebServer();
  
  // Inicializa perfis dos pets (valores padrão)
  initializePetProfiles();
  
  Serial.println("=== SISTEMA PRONTO ===");
  playStartupSound();
}

// =============== LOOP PRINCIPAL ===============
void loop() {
  // Atualiza WebSocket
  ws.cleanupClients();
  
  // Verifica conexão WiFi
  if (WiFi.status() != WL_CONNECTED && millis() - lastCheck > 30000) {
    connectWiFi();
    lastCheck = millis();
  }
  
  // Sincroniza NTP a cada hora
  if (millis() - lastNTPSync > 3600000) {
    syncTimeNTP();
    lastNTPSync = millis();
  }
  
  // Lê sensores a cada 5 segundos
  if (millis() - lastSensorRead > 5000) {
    readAllSensors();
    checkLowLevel();
    lastSensorRead = millis();
  }
  
  // Verifica horários de alimentação
  checkFeedingSchedule();
  
  // Verifica requisição manual
  if (manualFeedRequest >= 0) {
    processManualFeeding(manualFeedRequest);
    manualFeedRequest = -1;
  }
  
  // Verifica presença (modo automático por presença - opcional)
  checkPresenceFeeding();
  
  // Atualiza status do sistema
  updateSystemStatus();
  
  // Pequeno delay para não sobrecarregar
  delay(100);
}

// =============== FUNÇÕES DE CONTROLE DOS SERVOS ===============
void feedPet(int petId, float amount) {
  if (feedingInProgress) return;
  
  feedingInProgress = true;
  digitalWrite(LED_FEED, HIGH);
  
  Serial.printf("Alimentando pet %d com %.1fg\n", petId, amount);
  
  // Calcula tempo de abertura baseado na quantidade
  int openTime = amount * msPerGram[petId - 1];
  
  // Seleciona e aciona o servo correto
  Servo* targetServo;
  switch(petId) {
    case 1: targetServo = &servo1; break;
    case 2: targetServo = &servo2; break;
    case 3: targetServo = &servo3; break;
    default: return;
  }
  
  // Abre o compartimento gradualmente
  for (int angle = servoCloseAngle[petId-1]; angle >= servoOpenAngle[petId-1]; angle -= 5) {
    targetServo->write(angle);
    delay(servoSpeed);
  }
  
  // Mantém aberto pelo tempo calculado
  delay(openTime);
  
  // Vibração para ajudar a ração a cair (opcional)
  for (int i = 0; i < 3; i++) {
    targetServo->write(servoOpenAngle[petId-1] + 5);
    delay(50);
    targetServo->write(servoOpenAngle[petId-1]);
    delay(50);
  }
  
  // Fecha o compartimento
  for (int angle = servoOpenAngle[petId-1]; angle <= servoCloseAngle[petId-1]; angle += 5) {
    targetServo->write(angle);
    delay(servoSpeed);
  }
  
  // Registra no log
  addFeedingLog(petId, amount, "scheduled");
  
  // Emite som de confirmação
  playFeedingSound();
  
  digitalWrite(LED_FEED, LOW);
  feedingInProgress = false;
  
  // Envia atualização via WebSocket
  notifyClients();
}

void feedAllPets(float amount) {
  for (int i = 1; i <= 3; i++) {
    if (pets[i-1].isActive) {
      feedPet(i, amount);
      delay(2000); // Aguarda entre cada alimentação
    }
  }
}

void closeAllServos() {
  servo1.write(servoCloseAngle[0]);
  servo2.write(servoCloseAngle[1]);
  servo3.write(servoCloseAngle[2]);
}

// =============== FUNÇÕES DE SENSORES ===============
void readAllSensors() {
  // Lê níveis de ração (ultrassônico)
  int distance1 = sonar1.ping_cm();
  int distance2 = sonar2.ping_cm();
  int distance3 = sonar3.ping_cm();
  
  // Converte para percentual (assumindo recipiente de 30cm de altura)
  systemStatus.level1 = map(constrain(distance1, 5, 30), 30, 5, 0, 100);
  systemStatus.level2 = map(constrain(distance2, 5, 30), 30, 5, 0, 100);
  systemStatus.level3 = map(constrain(distance3, 5, 30), 30, 5, 0, 100);
  
  // Lê temperatura do RTC
  systemStatus.temperature = rtc.getTemperature();
}

void checkLowLevel() {
  // Alerta se algum compartimento está abaixo de 20%
  if (systemStatus.level1 < 20 || systemStatus.level2 < 20 || systemStatus.level3 < 20) {
    digitalWrite(LED_ALERT, HIGH);
    
    // Envia notificação (implementar Telegram/WhatsApp)
    if (millis() % 60000 < 100) { // Uma vez por minuto
      sendLowLevelAlert();
    }
  } else {
    digitalWrite(LED_ALERT, LOW);
  }
}

void checkPresenceFeeding() {
  // Modo de alimentação por presença (opcional)
  // Útil para gatos que comem em horários irregulares
  static unsigned long lastPresenceFeed[3] = {0, 0, 0};
  unsigned long currentTime = millis();
  
  // Intervalo mínimo entre alimentações por presença (2 horas)
  const unsigned long minInterval = 7200000;
  
  for (int i = 0; i < 3; i++) {
    if (digitalRead(PIR_1 + i) == HIGH && pets[i].isActive) {
      if (currentTime - lastPresenceFeed[i] > minInterval) {
        // Dispensa pequena porção ao detectar presença
        feedPet(i + 1, pets[i].portionSize * 0.3);
        lastPresenceFeed[i] = currentTime;
        
        Serial.printf("Alimentação por presença: Gato %d\n", i + 1);
      }
    }
  }
}

// =============== FUNÇÕES DE HORÁRIO ===============
void checkFeedingSchedule() {
  static int lastMinute = -1;
  
  DateTime now = rtc.now();
  int currentHour = now.hour();
  int currentMinute = now.minute();
  int currentDay = now.dayOfTheWeek();
  
  // Evita múltiplas alimentações no mesmo minuto
  if (currentMinute == lastMinute) return;
  lastMinute = currentMinute;
  
  // Verifica cada horário programado
  for (int i = 0; i < 20; i++) {
    if (!schedules[i].isActive) continue;
    if (!schedules[i].weekdays[currentDay]) continue;
    
    if (schedules[i].hour == currentHour && schedules[i].minute == currentMinute) {
      Serial.printf("Horário de alimentação: %02d:%02d\n", currentHour, currentMinute);
      
      if (schedules[i].petId == 0) {
        // Alimenta todos
        feedAllPets(schedules[i].amount);
      } else {
        // Alimenta pet específico
        feedPet(schedules[i].petId, schedules[i].amount);
      }
      
      systemStatus.lastFeedingHour = currentHour;
      systemStatus.lastFeedingMinute = currentMinute;
    }
  }
}

void syncTimeNTP() {
  if (WiFi.status() == WL_CONNECTED) {
    timeClient.update();
    
    unsigned long epochTime = timeClient.getEpochTime();
    rtc.adjust(DateTime(epochTime));
    
    Serial.println("Horário sincronizado via NTP");
    systemStatus.rtcSynced = true;
  }
}

// =============== FUNÇÕES DE CONFIGURAÇÃO ===============
void initializePetProfiles() {
  // Perfil Gato 1
  pets[0].name = "Felix";
  pets[0].dailyAmount = 60.0;
  pets[0].mealsPerDay = 3;
  pets[0].portionSize = 20.0;
  pets[0].isActive = true;
  pets[0].color = 0xFF6B6B;
  
  // Perfil Gato 2
  pets[1].name = "Luna";
  pets[1].dailyAmount = 50.0;
  pets[1].mealsPerDay = 3;
  pets[1].portionSize = 16.7;
  pets[1].isActive = true;
  pets[1].color = 0x4ECDC4;
  
  // Perfil Gato 3
  pets[2].name = "Max";
  pets[2].dailyAmount = 70.0;
  pets[2].mealsPerDay = 3;
  pets[2].portionSize = 23.3;
  pets[2].isActive = true;
  pets[2].color = 0x95E77E;
  
  // Horários padrão
  setupDefaultSchedules();
}

void setupDefaultSchedules() {
  // Café da manhã - 07:00
  schedules[0].hour = 7;
  schedules[0].minute = 0;
  schedules[0].petId = 0; // Todos
  schedules[0].amount = 20.0;
  schedules[0].isActive = true;
  for (int i = 0; i < 7; i++) schedules[0].weekdays[i] = true;
  
  // Almoço - 12:00
  schedules[1].hour = 12;
  schedules[1].minute = 0;
  schedules[1].petId = 0;
  schedules[1].amount = 15.0;
  schedules[1].isActive = true;
  for (int i = 0; i < 7; i++) schedules[1].weekdays[i] = true;
  
  // Jantar - 19:00
  schedules[2].hour = 19;
  schedules[2].minute = 0;
  schedules[2].petId = 0;
  schedules[2].amount = 25.0;
  schedules[2].isActive = true;
  for (int i = 0; i < 7; i++) schedules[2].weekdays[i] = true;
}

// =============== FUNÇÕES DE ARMAZENAMENTO ===============
void saveConfiguration() {
  // Salva configurações na memória flash
  preferences.clear();
  
  // Salva perfis dos pets
  for (int i = 0; i < 3; i++) {
    String key = "pet" + String(i);
    preferences.putString(key + "_name", pets[i].name);
    preferences.putFloat(key + "_daily", pets[i].dailyAmount);
    preferences.putInt(key + "_meals", pets[i].mealsPerDay);
    preferences.putFloat(key + "_portion", pets[i].portionSize);
    preferences.putBool(key + "_active", pets[i].isActive);
  }
  
  // Salva horários
  int activeSchedules = 0;
  for (int i = 0; i < 20; i++) {
    if (schedules[i].isActive) {
      String key = "sched" + String(activeSchedules);
      preferences.putInt(key + "_h", schedules[i].hour);
      preferences.putInt(key + "_m", schedules[i].minute);
      preferences.putInt(key + "_pet", schedules[i].petId);
      preferences.putFloat(key + "_amt", schedules[i].amount);
      activeSchedules++;
    }
  }
  preferences.putInt("schedCount", activeSchedules);
  
  Serial.println("Configurações salvas");
}

void loadConfiguration() {
  // Carrega configurações da memória flash
  
  // Carrega perfis dos pets
  for (int i = 0; i < 3; i++) {
    String key = "pet" + String(i);
    pets[i].name = preferences.getString(key + "_name", "Pet " + String(i+1));
    pets[i].dailyAmount = preferences.getFloat(key + "_daily", 60.0);
    pets[i].mealsPerDay = preferences.getInt(key + "_meals", 3);
    pets[i].portionSize = preferences.getFloat(key + "_portion", 20.0);
    pets[i].isActive = preferences.getBool(key + "_active", true);
  }
  
  // Carrega horários
  int schedCount = preferences.getInt("schedCount", 0);
  for (int i = 0; i < schedCount && i < 20; i++) {
    String key = "sched" + String(i);
    schedules[i].hour = preferences.getInt(key + "_h", 0);
    schedules[i].minute = preferences.getInt(key + "_m", 0);
    schedules[i].petId = preferences.getInt(key + "_pet", 0);
    schedules[i].amount = preferences.getFloat(key + "_amt", 20.0);
    schedules[i].isActive = true;
  }
  
  Serial.println("Configurações carregadas");
}

// =============== FUNÇÕES DE LOG ===============
void addFeedingLog(int petId, float amount, String trigger) {
  DateTime now = rtc.now();
  
  FeedingLog newLog;
  newLog.timestamp = String(now.year()) + "-" + 
                     String(now.month()) + "-" + 
                     String(now.day()) + " " +
                     String(now.hour()) + ":" + 
                     String(now.minute());
  newLog.petId = petId;
  newLog.amountDispensed = amount;
  newLog.triggerType = trigger;
  
  feedingHistory[historyIndex] = newLog;
  historyIndex = (historyIndex + 1) % 100;
  
  systemStatus.totalDispensedToday += amount;
}

String getFeedingHistoryJSON() {
  StaticJsonDocument<4096> doc;
  JsonArray array = doc.to<JsonArray>();
  
  for (int i = 0; i < 100; i++) {
    int idx = (historyIndex - i - 1 + 100) % 100;
    if (feedingHistory[idx].timestamp != "") {
      JsonObject obj = array.createNestedObject();
      obj["time"] = feedingHistory[idx].timestamp;
      obj["pet"] = feedingHistory[idx].petId;
      obj["amount"] = feedingHistory[idx].amountDispensed;
      obj["type"] = feedingHistory[idx].triggerType;
    }
  }
  
  String result;
  serializeJson(doc, result);
  return result;
}

// =============== FUNÇÕES DE REDE E COMUNICAÇÃO ===============
void connectWiFi() {
  Serial.print("Conectando ao WiFi");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_WIFI, !digitalRead(LED_WIFI));
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_WIFI, HIGH);
    systemStatus.wifiConnected = true;
  } else {
    Serial.println("\nFalha na conexão WiFi");
    digitalWrite(LED_WIFI, LOW);
    systemStatus.wifiConnected = false;
  }
}

void sendLowLevelAlert() {
  // Implementar envio de notificação
  // Pode ser via Telegram, WhatsApp Business API, ou email
  
  String message = "⚠️ ALERTA: Nível baixo de ração!\n";
  if (systemStatus.level1 < 20) message += "Compartimento 1: " + String(systemStatus.level1) + "%\n";
  if (systemStatus.level2 < 20) message += "Compartimento 2: " + String(systemStatus.level2) + "%\n";
  if (systemStatus.level3 < 20) message += "Compartimento 3: " + String(systemStatus.level3) + "%\n";
  
  // Exemplo com Telegram (necessita configurar bot)
  // sendTelegramMessage(message);
  
  Serial.println(message);
}

// =============== FUNÇÕES AUXILIARES ===============
void blinkLED(int pin, int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(delayMs);
    digitalWrite(pin, LOW);
    delay(delayMs);
  }
}

void playStartupSound() {
  tone(BUZZER_PIN, 523, 100); // C
  delay(150);
  tone(BUZZER_PIN, 659, 100); // E
  delay(150);
  tone(BUZZER_PIN, 784, 100); // G
  delay(150);
  tone(BUZZER_PIN, 1047, 200); // C
}

void playFeedingSound() {
  tone(BUZZER_PIN, 1047, 100);
  delay(110);
  tone(BUZZER_PIN, 1047, 100);
}

void updateSystemStatus() {
  systemStatus.uptime = millis() / 1000;
  systemStatus.wifiConnected = (WiFi.status() == WL_CONNECTED);
}

void processManualFeeding(int request) {
  if (request == 0) {
    feedAllPets(20.0); // Porção padrão manual
  } else if (request >= 1 && request <= 3) {
    feedPet(request, pets[request-1].portionSize);
  }
}

// =============== WEBSOCKET HANDLERS ===============
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, 
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WebSocket cliente #%u conectado\n", client->id());
    sendFullStatus(client);
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WebSocket cliente #%u desconectado\n", client->id());
  } else if (type == WS_EVT_DATA) {
    handleWebSocketMessage(arg, data, len, client);
  }
}

void handleWebSocketMessage(void *arg, uint8_t *data, size_t len, AsyncWebSocketClient *client) {
  AwsFrameInfo *info = (AwsFrameInfo*)arg;
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
    data[len] = 0;
    String message = (char*)data;
    
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, message);
    
    if (!error) {
      String action = doc["action"];
      
      if (action == "feed") {
        int petId = doc["petId"];
        manualFeedRequest = petId;
      } else if (action == "updatePet") {
        int petId = doc["petId"];
        pets[petId-1].name = doc["name"].as<String>();
        pets[petId-1].dailyAmount = doc["dailyAmount"];
        pets[petId-1].portionSize = doc["portionSize"];
        pets[petId-1].isActive = doc["isActive"];
        saveConfiguration();
      } else if (action == "updateSchedule") {
        int schedId = doc["schedId"];
        schedules[schedId].hour = doc["hour"];
        schedules[schedId].minute = doc["minute"];
        schedules[schedId].petId = doc["petId"];
        schedules[schedId].amount = doc["amount"];
        schedules[schedId].isActive = doc["isActive"];
        saveConfiguration();
      } else if (action == "getStatus") {
        sendFullStatus(client);
      } else if (action == "getHistory") {
        sendFeedingHistory(client);
      }
    }
  }
}

void notifyClients() {
  String status = getSystemStatusJSON();
  ws.textAll(status);
}

void sendFullStatus(AsyncWebSocketClient *client) {
  String status = getSystemStatusJSON();
  client->text(status);
}

void sendFeedingHistory(AsyncWebSocketClient *client) {
  String history = getFeedingHistoryJSON();
  client->text(history);
}

String getSystemStatusJSON() {
  StaticJsonDocument<1024> doc;
  
  doc["type"] = "status";
  doc["wifi"] = systemStatus.wifiConnected;
  doc["rtc"] = systemStatus.rtcSynced;
  doc["level1"] = systemStatus.level1;
  doc["level2"] = systemStatus.level2;
  doc["level3"] = systemStatus.level3;
  doc["temperature"] = systemStatus.temperature;
  doc["uptime"] = systemStatus.uptime;
  doc["totalToday"] = systemStatus.totalDispensedToday;
  doc["lastFeed"] = String(systemStatus.lastFeedingHour) + ":" + 
                     String(systemStatus.lastFeedingMinute);
  
  JsonArray petsArray = doc.createNestedArray("pets");
  for (int i = 0; i < 3; i++) {
    JsonObject pet = petsArray.createNestedObject();
    pet["name"] = pets[i].name;
    pet["daily"] = pets[i].dailyAmount;
    pet["portion"] = pets[i].portionSize;
    pet["active"] = pets[i].isActive;
  }
  
  String result;
  serializeJson(doc, result);
  return result;
}

// =============== CONFIGURAÇÃO DO SERVIDOR WEB ===============
void setupWebServer() {
  // WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  
  // Página principal
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(SPIFFS, "/index.html", "text/html");
  });
  
  // Arquivos estáticos
  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(SPIFFS, "/style.css", "text/css");
  });
  
  server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(SPIFFS, "/script.js", "application/javascript");
  });
  
  // API REST endpoints
  server.on("/api/feed", HTTP_POST, [](AsyncWebServerRequest *request) {
    if (request->hasParam("petId")) {
      int petId = request->getParam("petId")->value().toInt();
      manualFeedRequest = petId;
      request->send(200, "application/json", "{\"status\":\"ok\"}");
    } else {
      request->send(400, "application/json", "{\"error\":\"Missing petId\"}");
    }
  });
  
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", getSystemStatusJSON());
  });
  
  server.on("/api/history", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", getFeedingHistoryJSON());
  });
  
  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest *request) {
    String config = getConfigurationJSON();
    request->send(200, "application/json", config);
  });
  
  server.on("/api/config", HTTP_POST, [](AsyncWebServerRequest *request) {
    // Processa atualização de configuração
    request->send(200, "application/json", "{\"status\":\"ok\"}");
  });
  
  // Inicia servidor
  server.begin();
  Serial.println("Servidor HTTP iniciado");
}

String getConfigurationJSON() {
  StaticJsonDocument<2048> doc;
  
  JsonArray petsArray = doc.createNestedArray("pets");
  for (int i = 0; i < 3; i++) {
    JsonObject pet = petsArray.createNestedObject();
    pet["id"] = i + 1;
    pet["name"] = pets[i].name;
    pet["dailyAmount"] = pets[i].dailyAmount;
    pet["mealsPerDay"] = pets[i].mealsPerDay;
    pet["portionSize"] = pets[i].portionSize;
    pet["isActive"] = pets[i].isActive;
    pet["color"] = pets[i].color;
  }
  
  JsonArray schedulesArray = doc.createNestedArray("schedules");
  for (int i = 0; i < 20; i++) {
    if (schedules[i].isActive) {
      JsonObject sched = schedulesArray.createNestedObject();
      sched["id"] = i;
      sched["hour"] = schedules[i].hour;
      sched["minute"] = schedules[i].minute;
      sched["petId"] = schedules[i].petId;
      sched["amount"] = schedules[i].amount;
      sched["isActive"] = schedules[i].isActive;
      
      JsonArray days = sched.createNestedArray("weekdays");
      for (int j = 0; j < 7; j++) {
        days.add(schedules[i].weekdays[j]);
      }
    }
  }
  
  String result;
  serializeJson(doc, result);
  return result;
}
