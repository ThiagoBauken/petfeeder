# 🔋 GUIA COMPLETO - Bateria e Backup de Energia para PetFeeder

## 🎯 POR QUE ADICIONAR BATERIA?

**Problema:** Se a luz acabar, seu pet fica sem comida!

**Solução:** Bateria backup para continuar funcionando sem energia elétrica.

✅ **Alimentação em caso de queda de energia**
✅ **Autonomia de 8-24 horas**
✅ **PetFeeder portátil** (sem fio)
✅ **Proteção contra apagões**
✅ **Notificações de bateria baixa**

---

## 🔋 OPÇÕES DE BATERIA

### **Opção 1: Power Bank USB (MAIS SIMPLES)** ⭐⭐⭐⭐⭐

```
┌────────────────────────┐
│   Power Bank 10.000mAh │
│   ┌──────────────────┐ │
│   │ ████████ 85%     │ │
│   └──────────────────┘ │
│                        │
│   USB-A ───┬───────────┤
└────────────┼───────────┘
             │ Cabo USB
             ▼
      ┌─────────────┐
      │   ESP32     │
      │  (via USB)  │
      └─────────────┘
```

**Vantagens:**
- ✅ Muito fácil de usar
- ✅ Barato (R$ 50-80)
- ✅ Já tem circuito de proteção
- ✅ Pode carregar e usar simultaneamente
- ✅ LED indicador de carga

**Desvantagens:**
- ❌ Saída 5V apenas (não 3.3V direto)
- ❌ Menos eficiente

**Autonomia:**
- Power Bank 10.000mAh = ~20 horas
- Power Bank 20.000mAh = ~40 horas

**Preço:** R$ 50 - R$ 100

---

### **Opção 2: Bateria 18650 com Módulo (MELHOR CUSTO-BENEFÍCIO)** ⭐⭐⭐⭐⭐

```
┌──────────────────────────────┐
│ Módulo TP4056 + Proteção     │
│  ┌────┐                      │
│  │USB │ ← Carregamento       │
│  └────┘                      │
│  [+] [-] ← Saída para ESP32  │
└──────────────────────────────┘
       │
       ▼
┌──────────────┐
│ Bateria      │
│ 18650        │
│ 3.7V         │
│ 3000mAh      │
└──────────────┘
```

**Vantagens:**
- ✅ Barato (R$ 30-40 total)
- ✅ Compacto
- ✅ Módulo TP4056 carrega automaticamente
- ✅ Proteção contra sobrecarga
- ✅ Fácil de integrar

**Desvantagens:**
- ❌ Precisa soldar
- ❌ Uma bateria = ~6 horas apenas

**Solução:** Use **2-4 baterias em paralelo**!

**Autonomia:**
- 1x 18650 (3000mAh) = ~6 horas
- 2x 18650 (6000mAh) = ~12 horas
- 4x 18650 (12000mAh) = ~24 horas

**Preço:**
- 1x Bateria 18650: R$ 15
- 1x Módulo TP4056: R$ 5
- 1x Suporte 18650: R$ 3
- **Total:** R$ 23 (1 bateria) a R$ 80 (4 baterias)

---

### **Opção 3: Bateria LiPo (MAIS COMPACTA)**

```
┌─────────────────┐
│  Bateria LiPo   │
│  3.7V 2000mAh   │
│  ┌──────────┐   │
│  │ [+]  [-] │   │
│  └──────────┘   │
└─────────────────┘
```

**Vantagens:**
- ✅ Muito compacta e leve
- ✅ Alta densidade de energia
- ✅ Boa para projetos móveis

**Desvantagens:**
- ❌ Mais cara (R$ 30-60)
- ❌ Delicada (pode inchar/pegar fogo)
- ❌ Precisa de módulo de proteção
- ❌ Cuidado com sobrecarga!

**Autonomia:**
- LiPo 2000mAh = ~4 horas
- LiPo 5000mAh = ~10 horas

**Preço:** R$ 30 - R$ 80

---

### **Opção 4: Baterias Recarregáveis AA (NiMH)**

```
┌─────────────────────────────┐
│  Suporte 4x AA              │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐       │
│  │AA│ │AA│ │AA│ │AA│       │
│  └──┘ └──┘ └──┘ └──┘       │
│  4x 1.2V = 4.8V             │
└─────────────────────────────┘
```

**Vantagens:**
- ✅ Fácil de trocar
- ✅ Não precisa soldar
- ✅ Seguro (não explode)

**Desvantagens:**
- ❌ Menor capacidade
- ❌ Mais pesado
- ❌ Tensão irregular (1.2V por célula)

**Autonomia:**
- 4x AA (2000mAh) = ~4 horas

**Preço:** R$ 40 - R$ 60

---

## 🔧 INTEGRAÇÃO COM ESP32

### **Circuito Básico - Power Bank USB:**

```
Power Bank ──USB──> ESP32 DevKit V1
(10.000mAh)         (pino VIN/5V)

✅ PRONTO! Mais simples impossível!
```

### **Circuito - Bateria 18650 + TP4056:**

```
                TP4056 Module
┌───────────────────────────────────┐
│  USB (Micro) ← Carregamento       │
│                                   │
│  BAT+ ─┬─ Bateria 18650 (+)      │
│        │                          │
│  BAT- ─┴─ Bateria 18650 (-)      │
│                                   │
│  OUT+ ───────────────────┐        │
│  OUT- ───────────────┐   │        │
└──────────────────────┼───┼────────┘
                       │   │
                       │   │    ESP32 DevKit V1
                       │   └───> GND
                       └───────> VIN (ou 5V)

⚠️ TP4056 saída = 3.7V - 4.2V
   ESP32 aceita 3.3V - 5V no VIN ✅
```

### **Circuito - Regulador de Tensão (Opcional):**

```
Bateria 18650 ──> Regulador ──> ESP32
  (3.7V-4.2V)       3.3V         3.3V

Regulador recomendado: AMS1117-3.3
Preço: R$ 2
```

---

## 📊 CONSUMO DE ENERGIA DO PETFEEDER

### **Componentes e Consumo:**

| Componente | Consumo | Tempo Ativo |
|-----------|---------|-------------|
| ESP32 (idle) | 80mA | 24h |
| ESP32 (WiFi TX) | 240mA | 10% do tempo |
| Motor 28BYJ-48 | 200mA | 30s por alimentação |
| Sensor HC-SR04 | 15mA | 5s a cada 5min |
| RTC DS3231 | 0.5mA | 24h |
| **TOTAL MÉDIO** | **~150mA** | **24h** |

### **Cálculo de Autonomia:**

```
Autonomia (horas) = Capacidade_Bateria (mAh) / Consumo_Médio (mA)

Exemplos:
- Power Bank 10.000mAh / 150mA = 66 horas ≈ 2.7 dias
- Bateria 18650 3000mAh / 150mA = 20 horas
- 2x 18650 6000mAh / 150mA = 40 horas ≈ 1.6 dias
```

**⚠️ IMPORTANTE:** Sempre considere apenas **70%** da capacidade nominal!

---

## ⚡ MODO DE ECONOMIA DE ENERGIA

Para aumentar a autonomia, adicione **Deep Sleep** no ESP32:

```cpp
/*
 * Modo de Economia de Energia
 * ESP32 acorda a cada 1 hora para:
 * - Verificar se é hora de alimentar
 * - Ler sensores
 * - Enviar telemetria
 */

#include <esp_sleep.h>

// Tempo de deep sleep (em microsegundos)
#define SLEEP_DURATION 3600e6  // 1 hora

void setup() {
  Serial.begin(115200);

  // Configurar timer de wakeup
  esp_sleep_enable_timer_wakeup(SLEEP_DURATION);

  // Sua lógica aqui
  checkSchedules();
  readSensors();
  sendTelemetry();

  // Entrar em deep sleep
  Serial.println("💤 Entrando em deep sleep...");
  esp_deep_sleep_start();
}

void loop() {
  // Nunca executa (deep sleep reinicia o ESP32)
}
```

**Consumo em Deep Sleep:** ~10µA (0.01mA)!

**Autonomia com Deep Sleep:**
- Power Bank 10.000mAh = **Meses!**
- Bateria 18650 3000mAh = **Semanas!**

---

## 🛒 O QUE COMPRAR - RECOMENDAÇÃO

### **Setup Básico (R$ 60):**

| Item | Preço |
|------|-------|
| Power Bank 10.000mAh | R$ 60 |
| **TOTAL** | **R$ 60** |

**Autonomia:** ~2-3 dias

---

### **Setup Avançado (R$ 80):**

| Item | Quantidade | Preço |
|------|-----------|-------|
| Bateria 18650 | 4 | R$ 60 |
| Módulo TP4056 | 1 | R$ 5 |
| Suporte 4x 18650 | 1 | R$ 10 |
| Regulador AMS1117 | 1 | R$ 2 |
| Jumpers | - | R$ 3 |
| **TOTAL** | - | **R$ 80** |

**Autonomia:** ~24 horas

---

### **Onde Comprar:**

- 🛒 **Power Bank:** Mercado Livre, Americanas, Magazine Luiza
- 🛒 **Bateria 18650:** Mercado Livre (buscar "18650 3000mah")
- 🛒 **TP4056:** Mercado Livre, Usinainfo, FilipeFlop
- 🛒 **AliExpress:** Mais barato, mas demora

---

## 💡 MONITORAMENTO DE BATERIA

### **Código - Ler Nível da Bateria:**

```cpp
/*
 * Monitorar tensão da bateria
 * GPIO 34 (ADC) conectado ao divisor de tensão
 */

const int BATTERY_PIN = 34;

float readBatteryVoltage() {
  int adcValue = analogRead(BATTERY_PIN);

  // ESP32 ADC: 0-4095 = 0-3.3V
  // Divisor de tensão 1:2 (R1=10k, R2=10k)
  float voltage = (adcValue / 4095.0) * 3.3 * 2.0;

  return voltage;
}

int getBatteryPercentage() {
  float voltage = readBatteryVoltage();

  // Bateria Li-ion: 3.0V (0%) a 4.2V (100%)
  int percentage = (int)((voltage - 3.0) / (4.2 - 3.0) * 100);

  // Limitar entre 0-100%
  if (percentage < 0) percentage = 0;
  if (percentage > 100) percentage = 100;

  return percentage;
}

void setup() {
  Serial.begin(115200);

  int battery = getBatteryPercentage();
  Serial.printf("🔋 Bateria: %d%%\n", battery);

  if (battery < 20) {
    Serial.println("⚠️ BATERIA BAIXA!");
    // Enviar alerta via MQTT
    sendLowBatteryAlert();
  }
}
```

### **Divisor de Tensão para ADC:**

```
Bateria+ ──┬─── R1 (10kΩ) ───┬─── GPIO 34 (ADC)
           │                 │
           │                 └─── R2 (10kΩ) ─── GND
           │
Bateria-  ─┘
```

**Por que?** ADC do ESP32 suporta 0-3.3V, bateria vai até 4.2V!

---

## 📊 DASHBOARD - MOSTRAR NÍVEL DA BATERIA

### **ESP32 envia via MQTT:**

```cpp
void sendTelemetry() {
  StaticJsonDocument<256> doc;

  doc["battery"] = getBatteryPercentage();
  doc["voltage"] = readBatteryVoltage();
  doc["charging"] = isCharging();  // Se estiver plugado

  String payload;
  serializeJson(doc, payload);

  mqttClient.publish(MQTT_TOPIC_TELEMETRY, payload.c_str());
}
```

### **Dashboard mostra:**

```html
<!-- dashboard.html -->
<div class="battery-status">
  <span id="batteryIcon">🔋</span>
  <span id="batteryLevel">85%</span>
  <progress id="batteryBar" max="100" value="85"></progress>
</div>
```

```javascript
// app.js
function updateBatteryStatus(level) {
  document.getElementById('batteryLevel').textContent = `${level}%`;
  document.getElementById('batteryBar').value = level;

  // Ícone conforme nível
  const icon = level > 80 ? '🔋' : level > 20 ? '🔋' : '🪫';
  document.getElementById('batteryIcon').textContent = icon;

  // Alerta se baixo
  if (level < 20) {
    showToast('⚠️ Bateria baixa! Conecte o carregador.', 'warning');
  }
}
```

---

## 🐛 TROUBLESHOOTING

### Problema 1: ESP32 não liga com bateria

**Causa:** Tensão muito baixa (<3.0V)

**Solução:**
```
- Carregue a bateria completamente
- Verifique polaridade (+/-)
- Use regulador de tensão
```

### Problema 2: Bateria descarrega rápido

**Causa:** Consumo alto (motores, WiFi)

**Solução:**
```cpp
// Desabilite WiFi quando não usar
WiFi.mode(WIFI_OFF);

// Use deep sleep
esp_deep_sleep_start();

// Desative motores após usar
stopAllMotors();
```

### Problema 3: Bateria não carrega

**Causa:** Módulo TP4056 com problema

**Solução:**
```
- Verifique LED do TP4056 (vermelho = carregando, azul = completo)
- Teste tensão de saída (deve ser ~4.2V quando cheio)
- Troque o módulo se defeituoso
```

---

## ✅ COMPARAÇÃO DAS OPÇÕES

| Opção | Preço | Autonomia | Facilidade | Recomendado |
|-------|-------|-----------|------------|-------------|
| **Power Bank** | R$ 60 | 2-3 dias | ⭐⭐⭐⭐⭐ | ✅ Iniciantes |
| **18650 + TP4056** | R$ 80 | 1-2 dias | ⭐⭐⭐ | ✅ DIY |
| **LiPo** | R$ 50 | 10h | ⭐⭐ | ❌ Perigoso |
| **AA NiMH** | R$ 50 | 4h | ⭐⭐⭐⭐ | ⚠️ Baixa autonomia |
| **Deep Sleep** | R$ 0 | Semanas | ⭐⭐ | ✅ Combo |

---

## 🎯 RECOMENDAÇÃO FINAL

### **Para Começar:**
```
✅ Power Bank 10.000mAh (R$ 60)
✅ Simples de usar
✅ Boa autonomia (2-3 dias)
✅ Não precisa soldar
```

### **Para Otimizar:**
```
✅ 4x Bateria 18650 + TP4056 (R$ 80)
✅ Código com Deep Sleep
✅ Monitoramento no dashboard
✅ Autonomia estendida
```

---

## 🚀 CHECKLIST

- [ ] Escolher tipo de bateria
- [ ] Comprar componentes
- [ ] Montar circuito
- [ ] Adicionar código de monitoramento
- [ ] Integrar com dashboard
- [ ] Testar autonomia
- [ ] Configurar alertas de bateria baixa

---

**🔋 COM BATERIA BACKUP, SEU PETFEEDER FUNCIONA SEMPRE!**

**Próximo:** [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)
