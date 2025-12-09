/*
 * PETFEEDER ESP32 - COM CONFIGURACAO WIFI VIA CAPTIVE PORTAL
 *
 * FUNCIONALIDADES:
 * - Configura WiFi pelo celular (sem precisar editar codigo)
 * - Salva configuracoes na memoria flash
 * - Sincroniza horarios com servidor
 * - Funciona offline apos configuracao
 *
 * PRIMEIRA EXECUCAO:
 * 1. ESP32 cria rede WiFi "PetFeeder-Setup"
 * 2. Conecte pelo celular nessa rede (senha: 12345678)
 * 3. Abre automaticamente pagina de configuracao
 * 4. Selecione sua rede WiFi e digite a senha
 * 5. Configure o Device ID do site
 * 6. Pronto! ESP32 reinicia e conecta
 *
 * PINOS:
 * Motor: GPIO 16, 17, 18, 19 (28BYJ-48)
 * Sensor: TRIG=23, ECHO=22 (HC-SR04)
 * LED: GPIO 2
 * Botao Reset Config: GPIO 0 (BOOT)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

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
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED e Botao
#define LED_PIN 2
#define RESET_PIN 0

// Motor
const int DOSE_SMALL = 2048;
const int DOSE_MEDIUM = 4096;
const int DOSE_LARGE = 6144;

const int stepSequence[8][4] = {
  {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0},
  {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}
};

// ==================== VARIAVEIS GLOBAIS ====================

Preferences preferences;
WebServer webServer(80);
DNSServer dnsServer;

String savedSSID = "";
String savedPassword = "";
String deviceId = "";

// Gera ID unico baseado no MAC Address
String getDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char id[18];
  sprintf(id, "PF_%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(id);
}

bool configMode = false;
bool wifiConnected = false;
int currentStep = 0;

struct Schedule {
  int hour;
  int minute;
  int doseSize;
  bool active;
};
Schedule schedules[10];
int scheduleCount = 0;

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

  Serial.printf("Dispensando %d passos...\n", steps);
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
  Serial.println("Alimentacao concluida!");
}

// ==================== SENSOR ====================

float readFoodLevel() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1;

  float distance = duration * 0.034 / 2;
  if (distance < 5) return 100;
  if (distance > 20) return 0;
  return map(distance, 20, 5, 0, 100);
}

// ==================== CONFIGURACAO PERSISTENTE ====================

void loadConfig() {
  preferences.begin("petfeeder", false);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("password", "");
  deviceId = preferences.getString("deviceId", "");

  Serial.println("\nConfiguracoes carregadas:");
  Serial.println("SSID: " + (savedSSID.length() > 0 ? savedSSID : "(nao configurado)"));
  Serial.println("Device ID: " + (deviceId.length() > 0 ? deviceId : "(nao configurado)"));
}

void saveConfig(String ssid, String password, String devId) {
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.putString("deviceId", devId);
  savedSSID = ssid;
  savedPassword = password;
  deviceId = devId;
  Serial.println("Configuracoes salvas!");
}

void clearConfig() {
  preferences.clear();
  savedSSID = "";
  savedPassword = "";
  deviceId = "";
  Serial.println("Configuracoes apagadas!");
}

void saveSchedulesToFlash() {
  preferences.putInt("schedCount", scheduleCount);
  for (int i = 0; i < scheduleCount; i++) {
    String key = "s" + String(i);
    preferences.putInt((key + "h").c_str(), schedules[i].hour);
    preferences.putInt((key + "m").c_str(), schedules[i].minute);
    preferences.putInt((key + "d").c_str(), schedules[i].doseSize);
    preferences.putBool((key + "a").c_str(), schedules[i].active);
  }
  Serial.println("Horarios salvos na flash");
}

void loadSchedulesFromFlash() {
  scheduleCount = preferences.getInt("schedCount", 0);
  for (int i = 0; i < scheduleCount; i++) {
    String key = "s" + String(i);
    schedules[i].hour = preferences.getInt((key + "h").c_str(), 0);
    schedules[i].minute = preferences.getInt((key + "m").c_str(), 0);
    schedules[i].doseSize = preferences.getInt((key + "d").c_str(), 2);
    schedules[i].active = preferences.getBool((key + "a").c_str(), true);
  }
  Serial.println(String(scheduleCount) + " horarios carregados da flash");
}

// ==================== COMUNICACAO COM SERVIDOR ====================

void sendFeedingLog(int doseSize) {
  if (!wifiConnected || deviceId.length() == 0) return;

  HTTPClient http;
  String url = serverUrl + "/api/feed/log";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String size = doseSize == 1 ? "small" : doseSize == 3 ? "large" : "medium";
  String json = "{\"deviceId\":\"" + deviceId + "\",\"size\":\"" + size + "\",\"trigger\":\"scheduled\"}";

  int httpCode = http.POST(json);
  if (httpCode == 200) {
    Serial.println("Log enviado ao servidor");
  } else {
    Serial.println("Erro ao enviar log: " + String(httpCode));
  }
  http.end();
}

void fetchSchedules() {
  if (!wifiConnected || deviceId.length() == 0) return;

  Serial.println("\nBuscando horarios do servidor...");

  HTTPClient http;
  String url = serverUrl + "/api/devices/" + deviceId + "/schedules";
  http.begin(url);
  http.setTimeout(10000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("Resposta: " + payload);

    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc["success"]) {
      JsonArray data = doc["data"];
      scheduleCount = 0;

      for (JsonObject item : data) {
        if (scheduleCount >= 10) break;

        schedules[scheduleCount].hour = item["hour"];
        schedules[scheduleCount].minute = item["minute"];

        String size = item["size"] | "medium";
        if (size == "small") schedules[scheduleCount].doseSize = 1;
        else if (size == "large") schedules[scheduleCount].doseSize = 3;
        else schedules[scheduleCount].doseSize = 2;

        schedules[scheduleCount].active = item["active"] | true;
        scheduleCount++;
      }

      Serial.println(String(scheduleCount) + " horarios carregados");
      saveSchedulesToFlash();
    }
  } else {
    Serial.println("Erro HTTP: " + String(httpCode));
    loadSchedulesFromFlash();
  }

  http.end();
}

// ==================== VERIFICACAO DE HORARIOS ====================

void checkSchedules() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;
  static int lastFedMinute = -1;

  if (currentMinute == lastFedMinute) return;

  for (int i = 0; i < scheduleCount; i++) {
    if (!schedules[i].active) continue;

    if (schedules[i].hour == currentHour && schedules[i].minute == currentMinute) {
      Serial.println("\nHorario de alimentacao!");
      Serial.printf("%02d:%02d - Dose: %s\n", currentHour, currentMinute,
                    schedules[i].doseSize == 1 ? "pequena" :
                    schedules[i].doseSize == 3 ? "grande" : "media");

      dispense(schedules[i].doseSize);
      lastFedMinute = currentMinute;
      sendFeedingLog(schedules[i].doseSize);
    }
  }
}

// ==================== WIFI ====================

bool connectWiFi() {
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
    .copy-btn{background:rgba(255,255,255,0.2);border:none;color:#fff;padding:8px 15px;border-radius:5px;margin-top:10px;cursor:pointer}
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128062;</div>
    <h1>PetFeeder Setup</h1>
    <p class="subtitle">Configure seu alimentador</p>

    <div class="device-id-box">
      <h3>ID DO DISPOSITIVO</h3>
      <div class="id" id="deviceIdDisplay">)rawliteral" + devId + R"rawliteral(</div>
      <p>Use este ID no site para vincular</p>
      <button class="copy-btn" onclick="copyId()">Copiar ID</button>
    </div>

    <div id="form">
      <button class="scan-btn" onclick="scanNetworks()">Buscar Redes WiFi</button>
      <div id="networks" class="networks"></div>
      <form id="configForm" onsubmit="saveConfig(event)">
        <label>Rede WiFi</label>
        <input type="text" id="ssid" placeholder="Selecione acima ou digite" required>
        <label>Senha WiFi</label>
        <input type="password" id="password" placeholder="Senha da rede" required>
        <input type="hidden" id="deviceId" value=")rawliteral" + devId + R"rawliteral(">
        <button type="submit">Conectar</button>
      </form>
    </div>
    <div id="loading" class="loading" style="display:none">
      <div class="spinner"></div>
      <p>Conectando...</p>
    </div>
    <div id="success" class="success" style="display:none">
      <h2>Configurado!</h2>
      <p>O ESP32 vai reiniciar e conectar ao WiFi.</p>
      <p style="margin-top:10px;font-size:14px">Agora va ao site e vincule o dispositivo com o ID:</p>
      <p style="font-size:20px;font-weight:bold;margin-top:5px">)rawliteral" + devId + R"rawliteral(</p>
    </div>
  </div>
  <script>
    function copyId(){
      navigator.clipboard.writeText(')rawliteral" + devId + R"rawliteral(');
      alert('ID copiado!');
    }
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
      data.append('deviceId',document.getElementById('deviceId').value);
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
  Serial.println("Escaneando redes WiFi...");
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
  String devId = webServer.arg("deviceId");

  Serial.println("\nSalvando configuracoes...");
  Serial.println("SSID: " + ssid);
  Serial.println("Device ID: " + devId);

  saveConfig(ssid, password, devId);
  webServer.send(200, "application/json", "{\"success\":true}");

  delay(2000);
  ESP.restart();
}

void handleStatus() {
  String json = "{";
  json += "\"configured\":" + String(savedSSID.length() > 0 ? "true" : "false") + ",";
  json += "\"ssid\":\"" + savedSSID + "\",";
  json += "\"deviceId\":\"" + deviceId + "\"";
  json += "}";
  webServer.send(200, "application/json", json);
}

void startConfigMode() {
  configMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.println("\n========================================");
  Serial.println("  MODO CONFIGURACAO ATIVADO");
  Serial.println("========================================");
  Serial.println("1. Conecte na rede: PetFeeder-Setup");
  Serial.println("2. Senha: 12345678");
  Serial.println("3. Acesse: http://192.168.4.1");
  Serial.println("========================================");
  Serial.println("IP: " + WiFi.softAPIP().toString());

  dnsServer.start(53, "*", WiFi.softAPIP());

  webServer.on("/", handleRoot);
  webServer.on("/scan", handleScan);
  webServer.on("/save", HTTP_POST, handleSave);
  webServer.on("/status", handleStatus);
  webServer.onNotFound(handleRoot);

  webServer.begin();
}

// ==================== MODO NORMAL ====================

void normalMode() {
  Serial.println("\nEntrando em modo normal de operacao");
  configMode = false;
  digitalWrite(LED_PIN, HIGH);
}

void checkResetButton() {
  if (digitalRead(RESET_PIN) == LOW) {
    Serial.println("\nBotao BOOT detectado...");
    unsigned long start = millis();

    while (digitalRead(RESET_PIN) == LOW) {
      if (millis() - start > 3000) {
        Serial.println("Limpando configuracoes...");
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

// ==================== CONFIGURACAO DE PINOS ====================

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
  delay(500);
  digitalWrite(LED_PIN, LOW);
}

// ==================== SETUP ====================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n");
  Serial.println("========================================");
  Serial.println("  PETFEEDER ESP32 - WiFi Setup Edition");
  Serial.println("========================================");

  setupPins();
  loadConfig();
  checkResetButton();

  if (savedSSID.length() > 0) {
    Serial.println("\nTentando conectar ao WiFi salvo...");
    Serial.println("SSID: " + savedSSID);

    if (connectWiFi()) {
      Serial.println("WiFi conectado!");
      Serial.println("IP: " + WiFi.localIP().toString());

      configTime(-3 * 3600, 0, "pool.ntp.org");
      fetchSchedules();
      normalMode();
      return;
    }
  }

  Serial.println("\nWiFi nao configurado ou falhou");
  Serial.println("Entrando em modo configuracao...");
  startConfigMode();
}

// ==================== LOOP ====================

void loop() {
  if (configMode) {
    dnsServer.processNextRequest();
    webServer.handleClient();

    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 200) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }
  } else {
    checkSchedules();

    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 2000) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }

    static unsigned long lastSync = 0;
    if (millis() - lastSync > 6UL * 3600000UL) {
      fetchSchedules();
      lastSync = millis();
    }

    delay(1000);
  }
}
