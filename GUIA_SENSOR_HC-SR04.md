# 📏 GUIA COMPLETO - Sensor HC-SR04 para PetFeeder

## 🎯 POR QUE O HC-SR04?

O **HC-SR04** é um sensor ultrassônico que mede a distância usando ondas sonoras, perfeito para detectar o nível de ração no compartimento!

```
┌─────────────────────────────────┐
│    COMPARTIMENTO DE RAÇÃO       │
│  ┌──────────────────────────┐   │
│  │   HC-SR04 (topo)         │   │
│  │      ↓↓↓                 │   │
│  │   [ondas sonoras]        │   │
│  │      ↓↓↓                 │   │
│  │   ════════  ← Ração      │   │
│  │   ════════               │   │
│  │   ════════               │   │
│  └──────────────────────────┘   │
│                                  │
│  Distância = Nível da ração!     │
└─────────────────────────────────┘
```

---

## ✅ ESPECIFICAÇÕES DO HC-SR04

| Característica | Valor |
|---------------|-------|
| **Tensão** | 5V DC |
| **Corrente** | 15mA |
| **Alcance** | 2cm a 400cm |
| **Precisão** | ±3mm |
| **Ângulo** | 15° |
| **Frequência** | 40kHz (ultrassom) |
| **Pinos** | 4 (VCC, Trig, Echo, GND) |
| **Preço** | R$ 8 - R$ 15 (unitário) |

---

## 🔌 PINOUT DO HC-SR04

```
Vista Frontal:
┌─────────────────────┐
│  ╔═══╗      ╔═══╗   │
│  ║ T ║      ║ R ║   │  T = Transmissor (envia ultrassom)
│  ╚═══╝      ╚═══╝   │  R = Receptor (recebe eco)
│                     │
└─────────────────────┘

Vista Traseira (Pinos):
┌─────────────────────┐
│                     │
│  VCC TRIG ECHO GND  │
│   │   │    │    │   │
└───┼───┼────┼────┼───┘
    │   │    │    │
    │   │    │    └─── GND (Terra)
    │   │    └──────── Echo (Saída - recebe sinal)
    │   └───────────── Trig (Entrada - envia pulso)
    └───────────────── VCC (+5V)
```

---

## 🔧 COMO FUNCIONA?

### Princípio de Funcionamento:

1. **Trig** recebe um pulso de 10µs (HIGH)
2. Sensor **transmite** 8 pulsos ultrassônicos (40kHz)
3. Ondas sonoras **viajam** até o objeto
4. Ondas **refletem** de volta
5. **Echo** fica HIGH durante o tempo de viagem
6. **Calculamos** distância: `distância = (tempo × velocidade_som) / 2`

```
Fórmula:
distância (cm) = (tempo_echo_HIGH × 0.0343) / 2

Onde:
- tempo em microssegundos (µs)
- 0.0343 = velocidade do som (343 m/s = 0.0343 cm/µs)
- dividido por 2 (ida + volta)
```

---

## 🎯 CONFIGURAÇÃO PARA PETFEEDER

### 3 Sensores HC-SR04 (um para cada compartimento):

```
                    ESP32 DevKit V1

   ┌────────────────────────────────────┐
   │                                    │
   │         [Micro USB]                │
   └────────────────────────────────────┘

   EN          ○                     ○ 3.3V
   VP (GPIO36) ○                     ○ GND
   VN (GPIO39) ○                     ○ GPIO15 ← Motor3_IN1
   GPIO34      ○                     ○ GPIO2  ← Motor3_IN2
   GPIO35      ○                     ○ GPIO0
   GPIO32      ○                     ○ GPIO4  ← Motor3_IN3
   GPIO33      ○                     ○ GPIO16 ← Sensor3_Trig
   GPIO25      ○                     ○ GPIO17 ← Sensor3_Echo
   GPIO26      ○                     ○ GPIO5  ← Motor3_IN4
   GPIO27      ○                     ○ GPIO18 ← Sensor1_Echo
   GPIO14      ○                     ○ GPIO19 ← Sensor1_Trig
   GPIO12      ○                     ○ GPIO21 ← SDA (RTC)
   GPIO13      ○                     ○ RX0
   GND         ○                     ○ TX0
   VIN (5V)    ○                     ○ GPIO22 ← Sensor2_Echo + SCL (RTC)
                                     ○ GPIO23 ← Sensor2_Trig
```

### Tabela de Conexões:

| Sensor | Trig (ESP32) | Echo (ESP32) | VCC | GND |
|--------|--------------|--------------|-----|-----|
| **Sensor 1** (Compartimento 1) | GPIO 19 | GPIO 18 | 5V (VIN) | GND |
| **Sensor 2** (Compartimento 2) | GPIO 23 | GPIO 22 | 5V (VIN) | GND |
| **Sensor 3** (Compartimento 3) | GPIO 16 | GPIO 17 | 5V (VIN) | GND |

---

## ⚠️ IMPORTANTE: DIVISOR DE TENSÃO PARA Echo

O ESP32 trabalha com **3.3V**, mas o HC-SR04 emite **5V** no pino Echo!

### ❌ PROBLEMA: Conectar Echo direto pode DANIFICAR o ESP32!

### ✅ SOLUÇÃO: Divisor de tensão com 2 resistores

```
HC-SR04 Echo (5V) ──┬─── Resistor 1kΩ ───┬─── GPIO Echo (ESP32)
                    │                    │
                    │                    └─── Resistor 2kΩ ─── GND
                    │
                    └─── Saída = 3.3V (seguro!)
```

**Cálculo:**
- V_out = V_in × (R2 / (R1 + R2))
- V_out = 5V × (2000Ω / (1000Ω + 2000Ω))
- V_out = 5V × 0.666 = **3.33V** ✅

### Conexão Completa para cada Sensor:

```
HC-SR04          ESP32 DevKit V1
┌──────┐         ┌──────┐
│ VCC  ├─────────┤ VIN  │ (5V)
│ GND  ├─────────┤ GND  │
│ TRIG ├─────────┤ GPIO │ (Direto, sem resistor)
│      │         │      │
│ ECHO ├───1kΩ───┼──┬───┤ GPIO │
└──────┘         │  │   └──────┘
                 │  │
                2kΩ │
                 │  │
                GND ┘
```

---

## 🛒 O QUE COMPRAR?

### Opção 1: Sensores Individuais (Recomendado)

| Item | Quantidade | Preço Unit. | Total |
|------|-----------|-------------|-------|
| HC-SR04 | 3 | R$ 10 | R$ 30 |
| Resistor 1kΩ | 3 | R$ 0,10 | R$ 0,30 |
| Resistor 2kΩ | 3 | R$ 0,10 | R$ 0,30 |
| **TOTAL** | - | - | **R$ 31** |

### Opção 2: Kit com 5 Sensores (Melhor custo-benefício)

| Item | Preço |
|------|-------|
| Kit 5x HC-SR04 | R$ 35-45 |
| Kit Resistores (sortido) | R$ 15 |
| **TOTAL** | **R$ 50** |

### Onde Comprar:

- 🛒 **Mercado Livre**: "HC-SR04" ou "sensor ultrassonico"
- 🛒 **Usinainfo**: https://www.usinainfo.com.br/
- 🛒 **FilipeFlop**: https://www.filipeflop.com/
- 🛒 **Baú da Eletrônica**: https://www.baudaeletronica.com.br/
- 🛒 **AliExpress**: Mais barato (R$ 15 por 5un), mas demora

---

## 🔬 CÓDIGO DE TESTE

Salve como `Teste_HC-SR04.ino`:

```cpp
/*
 * TESTE SENSOR HC-SR04 - PetFeeder
 * Testa 3 sensores ultrassônicos
 */

// Pinos dos Sensores (conforme PetFeeder)
const int trigPins[] = {19, 23, 16};
const int echoPins[] = {18, 22, 17};

// Altura do compartimento (em cm) - AJUSTE CONFORME SEU RECIPIENTE!
const float COMPARTMENT_HEIGHT = 20.0;  // 20cm de altura

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("   TESTE SENSORES HC-SR04 - PetFeeder");
  Serial.println("========================================\n");

  // Configurar pinos
  for (int i = 0; i < 3; i++) {
    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
    digitalWrite(trigPins[i], LOW);
  }

  delay(100);
  Serial.println("✅ Sensores configurados!\n");
}

void loop() {
  Serial.println("─────────────────────────────────────");
  Serial.println("Leitura dos 3 compartimentos:");
  Serial.println();

  for (int i = 0; i < 3; i++) {
    float distance = readDistance(i);

    if (distance < 0) {
      Serial.printf("  Compartimento %d: ❌ ERRO\n", i + 1);
      continue;
    }

    // Calcular nível (distância do sensor até ração)
    float level = COMPARTMENT_HEIGHT - distance;
    int percentage = (int)((level / COMPARTMENT_HEIGHT) * 100);

    // Garantir entre 0-100%
    if (percentage < 0) percentage = 0;
    if (percentage > 100) percentage = 100;

    Serial.printf("  Compartimento %d:\n", i + 1);
    Serial.printf("    Distância: %.1f cm\n", distance);
    Serial.printf("    Nível: %.1f cm\n", level);
    Serial.printf("    Porcentagem: %d%%\n", percentage);

    // Barra visual
    Serial.print("    [");
    int bars = percentage / 10;
    for (int j = 0; j < 10; j++) {
      Serial.print(j < bars ? "█" : "░");
    }
    Serial.println("]");

    // Alerta
    if (percentage < 20) {
      Serial.println("    ⚠️  NÍVEL BAIXO!");
    } else if (percentage > 80) {
      Serial.println("    ✅ CHEIO");
    }

    Serial.println();
  }

  Serial.println("─────────────────────────────────────\n");

  delay(2000);  // Atualiza a cada 2 segundos
}

float readDistance(int sensorIndex) {
  // Limpar trigger
  digitalWrite(trigPins[sensorIndex], LOW);
  delayMicroseconds(2);

  // Enviar pulso de 10µs
  digitalWrite(trigPins[sensorIndex], HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPins[sensorIndex], LOW);

  // Ler echo (timeout 30ms = ~5m máximo)
  long duration = pulseIn(echoPins[sensorIndex], HIGH, 30000);

  if (duration == 0) {
    return -1;  // Erro: timeout
  }

  // Calcular distância
  float distance = (duration * 0.0343) / 2.0;

  // Validar range
  if (distance < 2 || distance > 400) {
    return -1;  // Fora do range válido
  }

  return distance;
}
```

### Resultado Esperado:

```
========================================
   TESTE SENSORES HC-SR04 - PetFeeder
========================================

✅ Sensores configurados!

─────────────────────────────────────
Leitura dos 3 compartimentos:

  Compartimento 1:
    Distância: 5.2 cm
    Nível: 14.8 cm
    Porcentagem: 74%
    [███████░░░]

  Compartimento 2:
    Distância: 3.1 cm
    Nível: 16.9 cm
    Porcentagem: 84%
    [████████░░]
    ✅ CHEIO

  Compartimento 3:
    Distância: 16.8 cm
    Nível: 3.2 cm
    Porcentagem: 16%
    [█░░░░░░░░░]
    ⚠️  NÍVEL BAIXO!

─────────────────────────────────────
```

---

## 🎯 CALIBRAÇÃO DO SENSOR

### 1. Medir Altura do Compartimento:

```bash
# Com uma régua, meça a distância do sensor (topo) até o fundo do compartimento
COMPARTMENT_HEIGHT = medida_em_cm
```

### 2. Teste com Compartimento Vazio:

```bash
# Coloque o sensor no topo e leia a distância
# Deve ser próxima de COMPARTMENT_HEIGHT
```

### 3. Teste com Compartimento Cheio:

```bash
# Encha o compartimento com ração
# Distância deve ser menor (ex: 3-5cm)
```

### 4. Ajustar no Código:

```cpp
const float COMPARTMENT_HEIGHT = 20.0;  // Ajuste aqui!
```

---

## 🔧 INTEGRAÇÃO COM ESP32_SaaS_Client.ino

O código já está implementado! Veja as linhas relevantes:

### Pinos Configurados ([ESP32_SaaS_Client.ino:64-66](ESP32_SaaS_Client.ino#L64-L66)):

```cpp
const int trigPins[] = {19, 23, 16};
const int echoPins[] = {18, 22, 17};
```

### Função de Leitura (já implementada no firmware):

```cpp
void readSensors() {
  for (int i = 0; i < 3; i++) {
    float distance = readUltrasonic(i);
    float level = COMPARTMENT_HEIGHT - distance;
    int percentage = (int)((level / COMPARTMENT_HEIGHT) * 100);

    compartmentLevels[i] = constrain(percentage, 0, 100);
  }
}

float readUltrasonic(int index) {
  digitalWrite(trigPins[index], LOW);
  delayMicroseconds(2);
  digitalWrite(trigPins[index], HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPins[index], LOW);

  long duration = pulseIn(echoPins[index], HIGH, 30000);

  if (duration == 0) return -1;

  return (duration * 0.0343) / 2.0;
}
```

### Envio de Telemetria via MQTT:

```cpp
void sendTelemetry() {
  StaticJsonDocument<512> doc;

  JsonArray levels = doc.createNestedArray("levels");
  for (int i = 0; i < 3; i++) {
    levels.add(compartmentLevels[i]);
  }

  String payload;
  serializeJson(doc, payload);

  mqttClient.publish(MQTT_TOPIC_TELEMETRY, payload.c_str());
}
```

---

## 📊 VISUALIZAÇÃO NO DASHBOARD

O frontend já mostra o nível em tempo real:

```javascript
// frontend/js/app.js (já implementado)

// Atualiza níveis dos compartimentos
function updateLevels(deviceId, levels) {
  levels.forEach((level, index) => {
    const element = document.getElementById(`level-${index + 1}`);
    element.style.width = `${level}%`;
    element.textContent = `${level}%`;

    // Cores conforme nível
    if (level < 20) {
      element.className = 'level-bar level-low';  // Vermelho
    } else if (level < 50) {
      element.className = 'level-bar level-medium';  // Amarelo
    } else {
      element.className = 'level-bar level-high';  // Verde
    }
  });
}
```

---

## 🐛 TROUBLESHOOTING

### Problema 1: Leitura sempre 0 ou timeout

**Causas:**
- Sensor não recebe 5V
- Pinos Trig/Echo invertidos
- Cabo solto

**Solução:**
```bash
# Verificar tensão no VCC do sensor
# Deve ser 5V (use multímetro)

# Verificar conexões
# Trig deve ir para GPIO Trig
# Echo deve passar pelo divisor de tensão
```

### Problema 2: Leituras instáveis

**Causas:**
- Objetos próximos ao sensor
- Superfície da ração irregular
- Interferência entre sensores

**Solução:**
```cpp
// Usar média de 5 leituras
float readDistanceAverage(int sensorIndex) {
  float sum = 0;
  int validReadings = 0;

  for (int i = 0; i < 5; i++) {
    float reading = readDistance(sensorIndex);
    if (reading > 0) {
      sum += reading;
      validReadings++;
    }
    delay(10);
  }

  return validReadings > 0 ? sum / validReadings : -1;
}
```

### Problema 3: Sensor não detecta ração

**Causas:**
- Ração muito perto (<2cm)
- Ração absorve ultrassom (superfície irregular)
- Ângulo do sensor

**Solução:**
- Usar superfície plana sobre a ração (tampa leve)
- Posicionar sensor perpendicular
- Manter distância mínima de 2cm

---

## 💡 DICAS DE INSTALAÇÃO FÍSICA

### 1. Posicionamento do Sensor:

```
         ┌────────┐
         │ Sensor │ ← Fixar no topo do compartimento
         │ ↓↓↓↓↓  │
         └────────┘
            ││││
      ┌─────││││─────┐
      │     ││││     │
      │   ════════   │ ← Superfície da ração
      │   ════════   │
      │   ════════   │
      └──────────────┘
```

### 2. Fixação:

- Use fita dupla face
- Ou cola quente
- Ou parafusos M3
- **Importante:** Sensor deve ficar perpendicular à superfície

### 3. Distâncias Recomendadas:

| Situação | Distância |
|----------|-----------|
| Altura mínima do compartimento | 10cm |
| Altura máxima do compartimento | 30cm |
| Distância sensor-ração (vazio) | 2cm a 25cm |
| Distância sensor-ração (cheio) | 2cm (mínimo) |

---

## 📏 DIMENSÕES DO COMPARTIMENTO RECOMENDADAS

```
Vista Lateral:
┌────────────┐
│  [Sensor]  │ ← 2cm do topo
├────────────┤
│            │
│   ╔════╗   │ ← 20cm útil
│   ║    ║   │   para ração
│   ║    ║   │
│   ╚════╝   │
└────────────┘
  Diâmetro:
  10-15cm
```

---

## 🎯 CHECKLIST DE COMPRA

Ao comprar o HC-SR04, verifique:

- [ ] **Modelo**: HC-SR04 (não HC-SR04+)
- [ ] **Tensão**: 5V (não 3.3V)
- [ ] **Quantidade**: 3 unidades (mínimo)
- [ ] **Resistores**: 3x 1kΩ + 3x 2kΩ (para divisor de tensão)
- [ ] **Jumpers**: Para conexões
- [ ] **Opcional**: Protoboard para testes

---

## 🔌 ESQUEMA ELÉTRICO COMPLETO

### Sensor 1 (Compartimento 1):

```
HC-SR04 #1              ESP32
┌──────┐                ┌──────┐
│ VCC  ├────────────────┤ VIN  │ 5V
│ GND  ├────────────────┤ GND  │
│ TRIG ├────────────────┤ GPIO19│
│      │          ┌─────┤      │
│ ECHO ├──1kΩ─────┤     │GPIO18│
└──────┘     │    │     └──────┘
            2kΩ   │
             │    │
            GND   │
                  │
            (3.3V para ESP32)
```

**Repita para Sensores 2 e 3** com os respectivos GPIOs!

---

## 📦 RESUMO: O QUE VOCÊ PRECISA

| Item | Quantidade | Preço |
|------|-----------|-------|
| HC-SR04 | 3 | R$ 30 |
| Resistor 1kΩ | 3 | R$ 0,30 |
| Resistor 2kΩ | 3 | R$ 0,30 |
| Jumpers | 12 | R$ 5 |
| **TOTAL** | - | **R$ 35** |

---

## ✅ CONCLUSÃO

O **HC-SR04** é:
- ✅ Barato (R$ 10/unidade)
- ✅ Preciso (±3mm)
- ✅ Fácil de usar (4 pinos)
- ✅ Código já implementado
- ✅ Integrado com backend via MQTT
- ✅ Visualização no dashboard em tempo real

**🎉 PERFEITO PARA O PETFEEDER!**

---

**Próximo passo:** [Teste_HC-SR04.ino](Teste_HC-SR04.ino) ou leia [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)
