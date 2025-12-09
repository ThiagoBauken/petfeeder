/*
 * ═══════════════════════════════════════════════════════════════════
 * PETFEEDER ESP32 - COM CONFIGURACAO WIFI VIA CAPTIVE PORTAL
 * ═══════════════════════════════════════════════════════════════════
 *
 * FUNCIONALIDADES:
 * - Configura WiFi pelo celular (sem precisar editar código)
 * - Salva configurações na memória flash
 * - Sincroniza horários com servidor
 * - Deep Sleep para economia de energia
 * - Funciona offline após configuração
 *
 * PRIMEIRA EXECUÇÃO:
 * 1. ESP32 cria rede WiFi "PetFeeder-Setup"
 * 2. Conecte pelo celular nessa rede
 * 3. Abre automaticamente página de configuração
 * 4. Selecione sua rede WiFi e digite a senha
 * 5. Configure o Device ID do site
 * 6. Pronto! ESP32 reinicia e conecta
 *
 * PINOS:
 * Motor: GPIO 16, 17, 18, 19 (28BYJ-48)
 * Sensor: TRIG=23, ECHO=22 (HC-SR04)
 * LED: GPIO 2
 * Botão Reset Config: GPIO 0 (BOOT)
 *
 * ═══════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════

// Access Point para configuração
const char* AP_SSID = "PetFeeder-Setup";
const char* AP_PASS = "12345678";

// Servidor (Easypanel)
String serverUrl = "https://telegram-petfeeder.pbzgje.easypanel.host";

// Pinos do Motor 28BYJ-48
#define MOTOR_IN1 16
#define MOTOR_IN2 17
#define MOTOR_IN3 18
#define MOTOR_IN4 19

// Pinos do Sensor HC-SR04
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED e Botão
#define LED_PIN 2
#define RESET_PIN 0  // Botão BOOT

// Motor
const int STEPS_PER_REVOLUTION = 2048;
const int DOSE_SMALL = 2048;   // ~50g
const int DOSE_MEDIUM = 4096;  // ~100g
const int DOSE_LARGE = 6144;   // ~150g

// Sequência half-step
const int stepSequence[8][4] = {
  {1, 0, 0, 0}, {1, 1, 0, 0}, {0, 1, 0, 0}, {0, 1, 1, 0},
  {0, 0, 1, 0}, {0, 0, 1, 1}, {0, 0, 0, 1}, {1, 0, 0, 1}
};

// ═══════════════════════════════════════════════════════════════════
// VARIÁVEIS GLOBAIS
// ═══════════════════════════════════════════════════════════════════

Preferences preferences;
WebServer webServer(80);
DNSServer dnsServer;

// Configurações salvas
String savedSSID = "";
String savedPassword = "";
String deviceId = "";

// Estado
bool configMode = false;
bool wifiConnected = false;
int currentStep = 0;

// Horários (máximo 10)
struct Schedule {
  int hour;
  int minute;
  int doseSize;  // 1=small, 2=medium, 3=large
  bool active;
};
Schedule schedules[10];
int scheduleCount = 0;

// ═══════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n");
  Serial.println("╔═══════════════════════════════════════════╗");
  Serial.println("║   PETFEEDER ESP32 - WiFi Setup Edition    ║");
  Serial.println("╚═══════════════════════════════════════════╝");

  // Configura pinos
  setupPins();

  // Carrega configurações salvas
  loadConfig();

  // Verifica botão de reset (segurar BOOT por 3 segundos)
  checkResetButton();

  // Tenta conectar ao WiFi salvo
  if (savedSSID.length() > 0) {
    Serial.println("\n📡 Tentando conectar ao WiFi salvo...");
    Serial.println("   SSID: " + savedSSID);

    if (connectWiFi()) {
      Serial.println("✅ WiFi conectado!");
      Serial.println("   IP: " + WiFi.localIP().toString());

      // Sincroniza horário NTP
      configTime(-3 * 3600, 0, "pool.ntp.org");

      // Busca horários do servidor
      fetchSchedules();

      // Modo normal de operação
      normalMode();
      return;
    }
  }

  // Se não conectou, entra em modo configuração
  Serial.println("\n⚠️ WiFi não configurado ou falhou");
  Serial.println("   Entrando em modo configuração...");
  startConfigMode();
}

// ═══════════════════════════════════════════════════════════════════
// LOOP
// ═══════════════════════════════════════════════════════════════════

void loop() {
  if (configMode) {
    // Modo configuração - processa requisições web
    dnsServer.processNextRequest();
    webServer.handleClient();

    // Pisca LED rápido
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 200) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }
  } else {
    // Modo normal - verifica horários
    checkSchedules();

    // Pisca LED lento (mostra que está funcionando)
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 2000) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }

    // Sincroniza a cada 6 horas
    static unsigned long lastSync = 0;
    if (millis() - lastSync > 6 * 3600000UL) {
      fetchSchedules();
      lastSync = millis();
    }

    delay(1000);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE PINOS
// ═══════════════════════════════════════════════════════════════════

void setupPins() {
  // Motor
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  stopMotor();

  // Sensor
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // LED e Botão
  pinMode(LED_PIN, OUTPUT);
  pinMode(RESET_PIN, INPUT_PULLUP);

  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO PERSISTENTE
// ═══════════════════════════════════════════════════════════════════

void loadConfig() {
  preferences.begin("petfeeder", false);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("password", "");
  deviceId = preferences.getString("deviceId", "");

  Serial.println("\n📂 Configurações carregadas:");
  Serial.println("   SSID: " + (savedSSID.length() > 0 ? savedSSID : "(não configurado)"));
  Serial.println("   Device ID: " + (deviceId.length() > 0 ? deviceId : "(não configurado)"));
}

void saveConfig(String ssid, String password, String devId) {
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.putString("deviceId", devId);

  savedSSID = ssid;
  savedPassword = password;
  deviceId = devId;

  Serial.println("\n💾 Configurações salvas!");
}

void clearConfig() {
  preferences.clear();
  savedSSID = "";
  savedPassword = "";
  deviceId = "";
  Serial.println("\n🗑️ Configurações apagadas!");
}

// ═══════════════════════════════════════════════════════════════════
// CONEXÃO WIFI
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// MODO CONFIGURAÇÃO (CAPTIVE PORTAL)
// ═══════════════════════════════════════════════════════════════════

void startConfigMode() {
  configMode = true;

  // Cria Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.println("\n╔═══════════════════════════════════════════╗");
  Serial.println("║     MODO CONFIGURAÇÃO ATIVADO             ║");
  Serial.println("╠═══════════════════════════════════════════╣");
  Serial.println("║ 1. Conecte na rede: PetFeeder-Setup       ║");
  Serial.println("║ 2. Senha: 12345678                        ║");
  Serial.println("║ 3. Acesse: http://192.168.4.1             ║");
  Serial.println("╚═══════════════════════════════════════════╝");
  Serial.println("   IP: " + WiFi.softAPIP().toString());

  // Inicia servidor DNS (redireciona tudo para o ESP32)
  dnsServer.start(53, "*", WiFi.softAPIP());

  // Rotas do servidor web
  webServer.on("/", handleRoot);
  webServer.on("/scan", handleScan);
  webServer.on("/save", handleSave);
  webServer.on("/status", handleStatus);
  webServer.onNotFound(handleRoot);  // Captive portal

  webServer.begin();
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; padding: 20px;
    }
    .container {
      max-width: 400px; margin: 0 auto;
      background: white; border-radius: 20px;
      padding: 30px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { text-align: center; color: #333; margin-bottom: 10px; font-size: 24px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 30px; }
    .icon { text-align: center; font-size: 60px; margin-bottom: 20px; }
    label { display: block; margin-bottom: 5px; color: #333; font-weight: 500; }
    input, select {
      width: 100%; padding: 15px; margin-bottom: 20px;
      border: 2px solid #eee; border-radius: 10px;
      font-size: 16px; transition: border-color 0.3s;
    }
    input:focus, select:focus { border-color: #667eea; outline: none; }
    button {
      width: 100%; padding: 15px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border: none; border-radius: 10px;
      font-size: 18px; font-weight: bold; cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(102,126,234,0.4); }
    button:disabled { background: #ccc; transform: none; }
    .scan-btn { background: #4CAF50; margin-bottom: 15px; }
    .networks { margin-bottom: 20px; }
    .network {
      padding: 12px; background: #f5f5f5; border-radius: 8px;
      margin-bottom: 8px; cursor: pointer; display: flex;
      justify-content: space-between; align-items: center;
    }
    .network:hover { background: #e0e0e0; }
    .signal { color: #4CAF50; }
    .loading { text-align: center; padding: 20px; }
    .spinner {
      border: 3px solid #f3f3f3; border-top: 3px solid #667eea;
      border-radius: 50%; width: 30px; height: 30px;
      animation: spin 1s linear infinite; margin: 0 auto 10px;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .success { background: #4CAF50; color: white; padding: 20px; border-radius: 10px; text-align: center; }
    .error { background: #f44336; color: white; padding: 15px; border-radius: 10px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🐾</div>
    <h1>PetFeeder Setup</h1>
    <p class="subtitle">Configure seu alimentador</p>

    <div id="form">
      <button class="scan-btn" onclick="scanNetworks()">🔍 Buscar Redes WiFi</button>

      <div id="networks" class="networks"></div>

      <form id="configForm" onsubmit="saveConfig(event)">
        <label>Rede WiFi</label>
        <input type="text" id="ssid" placeholder="Nome da rede" required>

        <label>Senha WiFi</label>
        <input type="password" id="password" placeholder="Senha da rede" required>

        <label>Device ID (do site PetFeeder)</label>
        <input type="text" id="deviceId" placeholder="Ex: abc123" required>

        <button type="submit">💾 Salvar e Conectar</button>
      </form>
    </div>

    <div id="loading" class="loading" style="display:none">
      <div class="spinner"></div>
      <p>Conectando...</p>
    </div>

    <div id="success" class="success" style="display:none">
      <h2>✅ Configurado!</h2>
      <p>O ESP32 vai reiniciar e conectar ao WiFi.</p>
    </div>
  </div>

  <script>
    function scanNetworks() {
      document.getElementById('networks').innerHTML = '<div class="loading"><div class="spinner"></div><p>Buscando redes...</p></div>';
      fetch('/scan')
        .then(r => r.json())
        .then(data => {
          let html = '';
          data.networks.forEach(n => {
            html += '<div class="network" onclick="selectNetwork(\'' + n.ssid + '\')"><span>' + n.ssid + '</span><span class="signal">' + n.rssi + ' dBm</span></div>';
          });
          document.getElementById('networks').innerHTML = html || '<p>Nenhuma rede encontrada</p>';
        })
        .catch(e => {
          document.getElementById('networks').innerHTML = '<p class="error">Erro ao buscar redes</p>';
        });
    }

    function selectNetwork(ssid) {
      document.getElementById('ssid').value = ssid;
      document.getElementById('password').focus();
    }

    function saveConfig(e) {
      e.preventDefault();
      document.getElementById('form').style.display = 'none';
      document.getElementById('loading').style.display = 'block';

      const data = new URLSearchParams();
      data.append('ssid', document.getElementById('ssid').value);
      data.append('password', document.getElementById('password').value);
      data.append('deviceId', document.getElementById('deviceId').value);

      fetch('/save', { method: 'POST', body: data })
        .then(r => r.json())
        .then(data => {
          document.getElementById('loading').style.display = 'none';
          document.getElementById('success').style.display = 'block';
        })
        .catch(e => {
          document.getElementById('loading').style.display = 'none';
          document.getElementById('form').style.display = 'block';
          alert('Erro ao salvar. Tente novamente.');
        });
    }
  </script>
</body>
</html>
)rawliteral";

  webServer.send(200, "text/html", html);
}

void handleScan() {
  Serial.println("📡 Escaneando redes WiFi...");

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

  Serial.println("\n💾 Salvando configurações...");
  Serial.println("   SSID: " + ssid);
  Serial.println("   Device ID: " + devId);

  saveConfig(ssid, password, devId);

  webServer.send(200, "application/json", "{\"success\":true}");

  // Reinicia após 2 segundos
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

// ═══════════════════════════════════════════════════════════════════
// MODO NORMAL DE OPERAÇÃO
// ═══════════════════════════════════════════════════════════════════

void normalMode() {
  Serial.println("\n✅ Entrando em modo normal de operação");
  configMode = false;

  // LED aceso fixo = conectado
  digitalWrite(LED_PIN, HIGH);
}

void checkResetButton() {
  // Se botão BOOT pressionado por 3 segundos, limpa configurações
  if (digitalRead(RESET_PIN) == LOW) {
    Serial.println("\n⚠️ Botão BOOT detectado...");
    unsigned long start = millis();

    while (digitalRead(RESET_PIN) == LOW) {
      if (millis() - start > 3000) {
        Serial.println("🗑️ Limpando configurações...");
        clearConfig();

        // Pisca LED rápido
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

// ═══════════════════════════════════════════════════════════════════
// COMUNICAÇÃO COM SERVIDOR
// ═══════════════════════════════════════════════════════════════════

void fetchSchedules() {
  if (!wifiConnected || deviceId.length() == 0) return;

  Serial.println("\n📡 Buscando horários do servidor...");

  HTTPClient http;
  String url = serverUrl + "/api/devices/" + deviceId + "/schedules";

  http.begin(url);
  http.setTimeout(10000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("   Resposta: " + payload);

    // Parse JSON
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

      Serial.println("✅ " + String(scheduleCount) + " horários carregados");

      // Salva na flash para funcionar offline
      saveSchedulesToFlash();
    }
  } else {
    Serial.println("❌ Erro HTTP: " + String(httpCode));

    // Tenta carregar da flash
    loadSchedulesFromFlash();
  }

  http.end();
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

  Serial.println("💾 Horários salvos na flash");
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

  Serial.println("📂 " + String(scheduleCount) + " horários carregados da flash");
}

// ═══════════════════════════════════════════════════════════════════
// VERIFICAÇÃO DE HORÁRIOS
// ═══════════════════════════════════════════════════════════════════

void checkSchedules() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return;
  }

  int currentHour = timeinfo.tm_hour;
  int currentMinute = timeinfo.tm_min;
  static int lastFedMinute = -1;

  // Evita alimentar mais de uma vez no mesmo minuto
  if (currentMinute == lastFedMinute) return;

  for (int i = 0; i < scheduleCount; i++) {
    if (!schedules[i].active) continue;

    if (schedules[i].hour == currentHour &&
        schedules[i].minute == currentMinute) {

      Serial.println("\n⏰ Horário de alimentação!");
      Serial.printf("   %02d:%02d - Dose: %s\n",
                    currentHour, currentMinute,
                    schedules[i].doseSize == 1 ? "pequena" :
                    schedules[i].doseSize == 3 ? "grande" : "média");

      dispense(schedules[i].doseSize);
      lastFedMinute = currentMinute;

      // Envia log para servidor
      sendFeedingLog(schedules[i].doseSize);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTROLE DO MOTOR
// ═══════════════════════════════════════════════════════════════════

void dispense(int doseSize) {
  int steps;
  switch (doseSize) {
    case 1: steps = DOSE_SMALL; break;
    case 3: steps = DOSE_LARGE; break;
    default: steps = DOSE_MEDIUM; break;
  }

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
  digitalWrite(LED_PIN, LOW);
}

// ═══════════════════════════════════════════════════════════════════
// SENSOR ULTRASSÔNICO
// ═══════════════════════════════════════════════════════════════════

float readFoodLevel() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) return -1;

  float distance = duration * 0.034 / 2;

  // Converte para percentual (5cm=cheio, 20cm=vazio)
  if (distance < 5) return 100;
  if (distance > 20) return 0;
  return map(distance, 20, 5, 0, 100);
}

// ═══════════════════════════════════════════════════════════════════
// ENVIO DE LOGS
// ═══════════════════════════════════════════════════════════════════

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
    Serial.println("📤 Log enviado ao servidor");
  } else {
    Serial.println("❌ Erro ao enviar log: " + String(httpCode));
  }

  http.end();
}
