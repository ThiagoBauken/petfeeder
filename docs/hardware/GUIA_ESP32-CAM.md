# 📷 GUIA COMPLETO - ESP32-CAM para PetFeeder

## 🎯 POR QUE ADICIONAR CÂMERA?

Com a **ESP32-CAM**, você pode:

✅ **Ver seu pet comendo em tempo real**
✅ **Tirar fotos quando alimentar**
✅ **Detectar se o pet comeu a ração** (com IA)
✅ **Streaming de vídeo no dashboard**
✅ **Monitoramento remoto 24/7**
✅ **Detecção de movimento**

---

## 🎥 O QUE É O ESP32-CAM?

ESP32-CAM é um **módulo ESP32 com câmera integrada**:

```
┌────────────────────────────────┐
│    ESP32-CAM AI-Thinker        │
│  ┌──────────────────────────┐  │
│  │                          │  │
│  │      [Câmera OV2640]     │  │ ← Câmera 2MP
│  │                          │  │
│  └──────────────────────────┘  │
│                                │
│     [Chip ESP32-S]             │ ← Processador
│     [Slot MicroSD]             │ ← Armazenamento
│                                │
│  ○○○○○○○○○○○○○○○○                │ ← 16 pinos
└────────────────────────────────┘
```

---

## ✅ ESPECIFICAÇÕES DO ESP32-CAM

| Característica | Valor |
|---------------|-------|
| **Processador** | ESP32-S (240MHz) |
| **RAM** | 520KB SRAM |
| **Flash** | 4MB |
| **Câmera** | OV2640 (2MP) |
| **Resolução** | 1600x1200 (UXGA) |
| **WiFi** | 802.11 b/g/n |
| **Bluetooth** | 4.2 BLE |
| **MicroSD** | Até 4GB |
| **Tensão** | 5V |
| **Corrente** | 180mA (normal), 310mA (streaming) |
| **Preço** | R$ 25 - R$ 40 |

---

## 🔌 PINOUT DO ESP32-CAM

```
Vista Superior:
┌──────────────────────────────┐
│   ESP32-CAM AI-Thinker       │
│                              │
│   ┌──────────────┐           │
│   │   Câmera     │           │ ← Módulo OV2640
│   │   OV2640     │           │
│   └──────────────┘           │
│                              │
│   [ESP32-S Chip]             │
│                              │
│   [MicroSD Slot] ═══         │ ← Slot para cartão SD
│                              │
│  GND  5V  GPIO  ...  GPIO    │
│   ○   ○    ○    ...   ○      │
└──────────────────────────────┘

Pinos Principais:
┌─────────────┬──────────────────────────────┐
│ Pino        │ Função                       │
├─────────────┼──────────────────────────────┤
│ 5V          │ Alimentação 5V               │
│ GND         │ Terra                        │
│ U0R (GPIO3) │ RX (Serial)                  │
│ U0T (GPIO1) │ TX (Serial)                  │
│ GPIO 4      │ Flash LED                    │
│ GPIO 33     │ Flash branco (externo)       │
│ GPIO 12     │ MicroSD MISO                 │
│ GPIO 13     │ MicroSD MOSI                 │
│ GPIO 14     │ MicroSD SCK                  │
│ GPIO 15     │ MicroSD CS                   │
└─────────────┴──────────────────────────────┘
```

---

## 🛒 O QUE COMPRAR?

### Opção 1: ESP32-CAM Básico

| Item | Quantidade | Preço | Total |
|------|-----------|-------|-------|
| **ESP32-CAM AI-Thinker** | 1 | R$ 30 | R$ 30 |
| **Programador FTDI** | 1 | R$ 15 | R$ 15 |
| **Antena WiFi** | 1 | R$ 5 | R$ 5 |
| MicroSD 8GB (opcional) | 1 | R$ 15 | R$ 15 |
| **TOTAL** | - | - | **R$ 50** |

### Opção 2: Kit Completo

| Item | Preço |
|------|-------|
| ESP32-CAM + Programador | R$ 40 |
| Antena WiFi | R$ 5 |
| **TOTAL** | **R$ 45** |

### Onde Comprar:

- 🛒 **Mercado Livre**: "ESP32-CAM"
- 🛒 **Usinainfo**: https://www.usinainfo.com.br/
- 🛒 **FilipeFlop**: https://www.filipeflop.com/
- 🛒 **AliExpress**: Mais barato (R$ 15-20), mas demora

---

## ⚠️ IMPORTANTE: PROGRAMADOR FTDI

ESP32-CAM **NÃO TEM USB onboard**! Você precisa de um **programador FTDI** ou usar outro ESP32 como programador.

### Conexão FTDI ↔ ESP32-CAM:

```
FTDI             ESP32-CAM
┌──────┐         ┌──────────┐
│ 5V   ├─────────┤ 5V       │
│ GND  ├─────────┤ GND      │
│ TX   ├─────────┤ U0R      │ (cruzado!)
│ RX   ├─────────┤ U0T      │ (cruzado!)
└──────┘         │          │
                 │ GPIO 0 ──┼─── GND (para programar)
                 └──────────┘
```

**Para programar:**
1. Conecte GPIO 0 ao GND
2. Faça upload do código
3. Desconecte GPIO 0 do GND
4. Reset o ESP32-CAM

---

## 🎯 COMO INTEGRAR COM O PETFEEDER?

### Arquitetura:

```
┌──────────────────────────────────────────────────┐
│                  PETFEEDER                       │
│                                                  │
│  ┌─────────────┐           ┌──────────────┐     │
│  │  ESP32-CAM  │◄─WiFi────►│ ESP32 DevKit │     │
│  │  (Câmera)   │           │  (Controle)  │     │
│  └─────────────┘           └──────────────┘     │
│        │                          │              │
│        │                          │              │
│        └──────────┬───────────────┘              │
│                   │                              │
│                   ▼                              │
│            ┌─────────────┐                       │
│            │   Backend   │                       │
│            │    MQTT     │                       │
│            └─────────────┘                       │
│                   │                              │
│                   ▼                              │
│            ┌─────────────┐                       │
│            │  Dashboard  │                       │
│            │  (Streaming)│                       │
│            └─────────────┘                       │
└──────────────────────────────────────────────────┘
```

### 3 Formas de Integrar:

#### **Opção 1: ESP32-CAM Separado (RECOMENDADO)**
- ESP32-CAM apenas para câmera
- ESP32 DevKit V1 para motores/sensores
- Comunicam via WiFi/MQTT
- Mais modular e estável

#### **Opção 2: ESP32-CAM Único (Desafiador)**
- Um único ESP32-CAM faz tudo
- Controla motores + câmera
- Mais barato, mas menos GPIOs
- Pode ter problemas de memória

#### **Opção 3: Dual ESP32**
- 2 ESP32 DevKit V1 + Módulo câmera OV2640 separado
- Mais caro, mas mais flexível

---

## 📷 CÓDIGO BÁSICO - ESP32-CAM Streaming

```cpp
/*
 * ESP32-CAM - Streaming de Vídeo para PetFeeder
 * Upload via FTDI
 */

#include <WiFi.h>
#include <esp_camera.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// WiFi
const char* wifi_ssid = "SUA_REDE_WIFI";
const char* wifi_password = "SUA_SENHA";

// MQTT
const char* MQTT_SERVER = "SEU_IP_LOCAL";
const int MQTT_PORT = 1883;
const char* MQTT_USER = "server";
const char* MQTT_PASS = "server123";

// ID do dispositivo
String DEVICE_ID = "ESP32_CAM_001";

// Pinos da câmera (AI-Thinker)
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

WiFiClient espClient;
PubSubClient mqttClient(espClient);

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("   ESP32-CAM - PetFeeder");
  Serial.println("========================================\n");

  // Configurar câmera
  if (!setupCamera()) {
    Serial.println("❌ Erro ao inicializar câmera!");
    return;
  }

  // Conectar WiFi
  connectWiFi();

  // Configurar MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  Serial.println("✅ ESP32-CAM pronto!");
}

void loop() {
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Enviar frame a cada 100ms (10 FPS)
  static unsigned long lastFrame = 0;
  if (millis() - lastFrame > 100) {
    sendFrame();
    lastFrame = millis();
  }
}

bool setupCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Qualidade de vídeo
  if (psramFound()) {
    config.frame_size = FRAMESIZE_SVGA;  // 800x600
    config.jpeg_quality = 10;
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Erro 0x%x\n", err);
    return false;
  }

  Serial.println("✅ Câmera configurada!");
  return true;
}

void connectWiFi() {
  Serial.printf("Conectando WiFi: %s\n", wifi_ssid);
  WiFi.begin(wifi_ssid, wifi_password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n✅ WiFi conectado!");
  Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Conectando MQTT...");

    if (mqttClient.connect(DEVICE_ID.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" OK!");

      // Subscrever comandos
      String commandTopic = "devices/" + DEVICE_ID + "/command";
      mqttClient.subscribe(commandTopic.c_str());

      // Notificar que está online
      String statusTopic = "devices/" + DEVICE_ID + "/status";
      mqttClient.publish(statusTopic.c_str(), "{\"status\":\"online\"}");
    } else {
      Serial.printf(" falhou (rc=%d)\n", mqttClient.state());
      delay(5000);
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("MQTT: %s\n", topic);

  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  StaticJsonDocument<256> doc;
  deserializeJson(doc, message);

  String command = doc["command"];

  if (command == "snapshot") {
    // Tirar foto
    takeSnapshot();
  } else if (command == "startStream") {
    // Iniciar streaming
    Serial.println("▶️ Streaming iniciado");
  } else if (command == "stopStream") {
    // Parar streaming
    Serial.println("⏹️ Streaming parado");
  }
}

void sendFrame() {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Erro ao capturar frame");
    return;
  }

  // Enviar via MQTT (em chunks se necessário)
  String topic = "devices/" + DEVICE_ID + "/video/frame";

  // Para frames grandes, use HTTP ou WebRTC
  // MQTT tem limite de ~128KB por mensagem

  mqttClient.publish(topic.c_str(), fb->buf, fb->len);

  esp_camera_fb_return(fb);
}

void takeSnapshot() {
  Serial.println("📸 Tirando foto...");

  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Erro ao capturar foto");
    return;
  }

  // Enviar foto via MQTT
  String topic = "devices/" + DEVICE_ID + "/photo";
  mqttClient.publish(topic.c_str(), fb->buf, fb->len);

  esp_camera_fb_return(fb);

  Serial.println("✅ Foto enviada!");
}
```

---

## 🌐 SERVIDOR DE STREAMING

Para streaming de vídeo, use um servidor HTTP no ESP32-CAM:

```cpp
#include <WebServer.h>

WebServer server(80);

void handleStream() {
  WiFiClient client = server.client();

  String response = "HTTP/1.1 200 OK\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  server.sendContent(response);

  while (client.connected()) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) continue;

    client.print("--frame\r\n");
    client.print("Content-Type: image/jpeg\r\n\r\n");
    client.write(fb->buf, fb->len);
    client.print("\r\n");

    esp_camera_fb_return(fb);
  }
}

void setup() {
  // ... configuração anterior ...

  server.on("/stream", handleStream);
  server.begin();

  Serial.println("Stream: http://" + WiFi.localIP().toString() + "/stream");
}

void loop() {
  server.handleClient();
  mqttClient.loop();
}
```

**Acesse:** `http://IP_DO_ESP32_CAM/stream`

---

## 📊 INTEGRAÇÃO COM O DASHBOARD

### 1. Adicionar no Dashboard HTML:

```html
<!-- dashboard.html -->
<div class="camera-feed">
  <h3>📷 Câmera ao Vivo</h3>
  <img id="cameraStream" src="" alt="Carregando...">
  <button onclick="takePhoto()">📸 Tirar Foto</button>
</div>
```

### 2. JavaScript para Streaming:

```javascript
// frontend/js/app.js

function startCameraStream(deviceId) {
  // Buscar IP do ESP32-CAM do backend
  api.getDevice(deviceId).then(device => {
    const streamUrl = `http://${device.camera_ip}/stream`;
    document.getElementById('cameraStream').src = streamUrl;
  });
}

function takePhoto() {
  // Enviar comando via MQTT
  api.sendDeviceCommand(deviceId, 'snapshot').then(() => {
    showToast('📸 Foto tirada!');
  });
}
```

---

## 💡 FUNCIONALIDADES AVANÇADAS

### 1. **Detecção de Movimento**

```cpp
bool detectMotion(camera_fb_t* fb1, camera_fb_t* fb2) {
  int diff = 0;
  for (int i = 0; i < fb1->len; i += 100) {
    diff += abs(fb1->buf[i] - fb2->buf[i]);
  }
  return diff > 10000;  // Threshold
}
```

### 2. **Gravação em MicroSD**

```cpp
#include <SD_MMC.h>

void savePhoto() {
  if (!SD_MMC.begin()) {
    Serial.println("❌ SD não montado");
    return;
  }

  camera_fb_t * fb = esp_camera_fb_get();

  String path = "/photo_" + String(millis()) + ".jpg";
  File file = SD_MMC.open(path, FILE_WRITE);
  file.write(fb->buf, fb->len);
  file.close();

  esp_camera_fb_return(fb);
  Serial.println("💾 Foto salva: " + path);
}
```

### 3. **Reconhecimento de Pet (IA)**

Use **TensorFlow Lite** ou **Edge Impulse** para detectar se o pet comeu:

```cpp
#include <EloquentTinyML.h>

// Modelo treinado para detectar "pet comendo"
bool detectPetEating(camera_fb_t* fb) {
  // Processar imagem com modelo TinyML
  float prediction = model.predict(fb->buf);
  return prediction > 0.8;  // 80% confiança
}
```

---

## 🎯 CHECKLIST DE COMPRA

- [ ] **ESP32-CAM AI-Thinker** (R$ 30)
- [ ] **Programador FTDI** (R$ 15)
- [ ] **Antena WiFi** (incluída ou separada)
- [ ] **Jumpers** para conexão
- [ ] **MicroSD 8GB** (opcional, R$ 15)
- [ ] **Case/suporte** para câmera

**Total:** R$ 45 - R$ 60

---

## 🐛 TROUBLESHOOTING

### Problema 1: "Erro ao inicializar câmera"

**Solução:**
```cpp
// Adicione delay antes de inicializar
delay(1000);
esp_camera_init(&config);
```

### Problema 2: "Streaming lento"

**Solução:**
```cpp
// Reduza resolução
config.frame_size = FRAMESIZE_QVGA;  // 320x240

// Ou reduza qualidade
config.jpeg_quality = 15;  // 0-63 (maior = pior)
```

### Problema 3: "Memória insuficiente"

**Solução:**
```cpp
// Habilite PSRAM
config.fb_count = 2;  // Requer PSRAM
```

---

## ✅ RESUMO

| Recurso | ESP32-CAM | Custo |
|---------|-----------|-------|
| **Streaming ao vivo** | ✅ | R$ 45 |
| **Tirar fotos** | ✅ | Incluído |
| **Detectar movimento** | ✅ | Grátis (código) |
| **Gravar em SD** | ✅ | +R$ 15 (MicroSD) |
| **Reconhecimento IA** | ✅ | Grátis (TinyML) |

---

## 🚀 PRÓXIMOS PASSOS

1. **Compre:** ESP32-CAM + Programador (R$ 45)
2. **Teste:** Upload do código de streaming
3. **Integre:** Configure IP no dashboard
4. **Avançado:** Adicione IA para detectar pet

---

**📷 COM ESP32-CAM, SEU PETFEEDER FICA COMPLETO!**

**Próximo:** [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)
