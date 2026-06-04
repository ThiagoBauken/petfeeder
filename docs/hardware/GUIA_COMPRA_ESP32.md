# 🛒 GUIA DE COMPRA - ESP32 para PetFeeder

## 🎯 QUAL ESP32 COMPRAR?

### ✅ **RECOMENDAÇÃO #1: ESP32 DevKit V1 (30 pinos)**

**Melhor custo-benefício para o PetFeeder!**

```
┌─────────────────────────────┐
│     ESP32 DevKit V1         │
│  ┌───────────────────────┐  │
│  │                       │  │
│  │    [Chip ESP32]       │  │
│  │                       │  │
│  └───────────────────────┘  │
│ ○○○○○○○○○○○○○○○  ○○○○○○○○○○○○○○○ │
│ 15 pinos       15 pinos    │
│ (cada lado)    (cada lado) │
└─────────────────────────────┘
     30 pinos GPIO total
```

**Especificações:**
- ✅ Chip: ESP32-WROOM-32
- ✅ Dual-core 240MHz
- ✅ RAM: 520KB
- ✅ Flash: 4MB
- ✅ WiFi: 802.11 b/g/n
- ✅ Bluetooth: 4.2 BLE
- ✅ GPIOs: 30 pinos
- ✅ ADC: 18 canais
- ✅ DAC: 2 canais
- ✅ Touch: 10 pinos
- ✅ Alimentação: 5V USB ou Vin

**Preço:** R$ 35 - R$ 50

**Onde Comprar:**
- 🛒 Mercado Livre
- 🛒 Usinainfo
- 🛒 FilipeFlop
- 🛒 Baú da Eletrônica
- 🛒 AliExpress (mais barato, demora mais)

---

## ✅ **ALTERNATIVA #2: ESP32-WROOM-32 (38 pinos)**

**Mais pinos GPIO (se precisar expandir no futuro)**

```
┌──────────────────────────────────┐
│     ESP32-WROOM-32 (38 pinos)    │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │      [Chip ESP32]          │  │
│  │                            │  │
│  └────────────────────────────┘  │
│ ○○○○○○○○○○○○○○○○○○○  ○○○○○○○○○○○○○○○○○○○ │
│ 19 pinos           19 pinos     │
└──────────────────────────────────┘
```

**Vantagens:**
- Mais pinos GPIO (38 vs 30)
- Ideal se quiser adicionar mais sensores
- Mesmas especificações do DevKit V1

**Preço:** R$ 40 - R$ 55

---

## ❌ **NÃO RECOMENDADO para PetFeeder:**

### ESP32-C3 (RISC-V)
- ❌ Apenas 1 core (vs 2 cores)
- ❌ Menos GPIOs (22 vs 30)
- ⚠️ Pode funcionar, mas menos potente

### ESP32-S2
- ❌ Sem Bluetooth
- ❌ Single core
- ⚠️ Menos versátil

### ESP32-S3
- ✅ Mais potente (dual-core)
- ⚠️ Mais caro (R$ 60-80)
- ⚠️ Overkill para PetFeeder

### NodeMCU ESP32
- ⚠️ Funciona, mas pinout diferente
- ⚠️ Precisa adaptar código

---

## 📊 COMPARAÇÃO DETALHADA

| Modelo | Cores | GPIOs | WiFi | BT | Preço | PetFeeder |
|--------|-------|-------|------|----|----|-----------|
| **ESP32 DevKit V1** | 2 | 30 | ✓ | ✓ | R$ 35-50 | ⭐⭐⭐⭐⭐ |
| **ESP32-WROOM-32** | 2 | 38 | ✓ | ✓ | R$ 40-55 | ⭐⭐⭐⭐⭐ |
| ESP32-C3 | 1 | 22 | ✓ | ✓ | R$ 25-35 | ⭐⭐⭐ |
| ESP32-S2 | 1 | 43 | ✓ | ✗ | R$ 35-45 | ⭐⭐⭐ |
| ESP32-S3 | 2 | 45 | ✓ | ✓ | R$ 60-80 | ⭐⭐⭐⭐ |

---

## 🔌 PINOUT DO ESP32 DevKit V1 (RECOMENDADO)

```
                ESP32 DevKit V1 - 30 pinos

   ┌────────────────────────────────────┐
   │                                    │
   │         [Micro USB]                │
   │            ┌────┐                  │
   │            │    │                  │
   └────────────┴────┴──────────────────┘

   EN          ○                     ○ 3.3V
   VP (GPIO36) ○                     ○ GND
   VN (GPIO39) ○                     ○ GPIO15
   GPIO34      ○                     ○ GPIO2
   GPIO35      ○                     ○ GPIO0
   GPIO32      ○                     ○ GPIO4
   GPIO33      ○                     ○ GPIO16
   GPIO25      ○                     ○ GPIO17
   GPIO26      ○                     ○ GPIO5
   GPIO27      ○                     ○ GPIO18
   GPIO14      ○                     ○ GPIO19
   GPIO12      ○                     ○ GPIO21
   GPIO13      ○                     ○ RX0
   GND         ○                     ○ TX0
   VIN         ○                     ○ GPIO22
                                     ○ GPIO23

   LADO ESQUERDO (15 pinos)  LADO DIREITO (15 pinos)
```

---

## 🎯 CONFIGURAÇÃO PARA PETFEEDER

### Pinos Usados no Projeto:

**Motores 28BYJ-48 (3 motores = 12 pinos):**
```
Motor 1: GPIO 13, 12, 14, 27
Motor 2: GPIO 26, 25, 33, 32
Motor 3: GPIO 15, 2, 4, 5
```

**Sensores HC-SR04 (3 sensores = 6 pinos):**
```
Sensor 1: GPIO 19 (Trig), GPIO 18 (Echo)
Sensor 2: GPIO 23 (Trig), GPIO 22 (Echo)
Sensor 3: GPIO 16 (Trig), GPIO 17 (Echo)
```

**RTC DS3231 (I2C = 2 pinos):**
```
SDA: GPIO 21
SCL: GPIO 22 (compartilhado)
```

**Total de pinos usados: 20 pinos**

✅ **ESP32 DevKit V1 (30 pinos) tem GPIO SUFICIENTE!**

---

## 🛒 ONDE COMPRAR NO BRASIL

### **1. Mercado Livre** ⭐⭐⭐⭐⭐
- ✅ Entrega rápida (2-7 dias)
- ✅ Preço competitivo
- ✅ Frete grátis (muitas vezes)
- 💰 R$ 35 - R$ 50

**Buscar por:** "ESP32 DevKit V1"

### **2. Usinainfo** ⭐⭐⭐⭐
- ✅ Loja confiável
- ✅ Nota fiscal
- ✅ Suporte técnico
- 💰 R$ 45 - R$ 55

**Link:** https://www.usinainfo.com.br/

### **3. FilipeFlop** ⭐⭐⭐⭐
- ✅ Especializada em Arduino/ESP
- ✅ Tutoriais inclusos
- ✅ Suporte
- 💰 R$ 45 - R$ 60

**Link:** https://www.filipeflop.com/

### **4. Baú da Eletrônica** ⭐⭐⭐⭐
- ✅ Preços competitivos
- ✅ Variedade
- 💰 R$ 40 - R$ 55

**Link:** https://www.baudaeletronica.com.br/

### **5. AliExpress** ⭐⭐⭐
- ✅ Mais barato (R$ 20-30)
- ❌ Demora 30-60 dias
- ⚠️ Risco de taxação

**Buscar por:** "ESP32 DevKit V1 30 pin"

---

## 📦 KIT COMPLETO RECOMENDADO

### **Opção 1: Comprar Separado**

| Item | Preço | Loja |
|------|-------|------|
| ESP32 DevKit V1 | R$ 45 | Mercado Livre |
| 3x Motor 28BYJ-48 + ULN2003 | R$ 60 | Mercado Livre |
| 3x Sensor HC-SR04 | R$ 30 | Mercado Livre |
| RTC DS3231 | R$ 15 | Mercado Livre |
| Fonte 5V 3A | R$ 25 | Mercado Livre |
| Jumpers 40 unid | R$ 10 | Mercado Livre |
| Protoboard 830 | R$ 15 | Mercado Livre |
| **TOTAL** | **R$ 200** | - |

### **Opção 2: Kit ESP32 Completo**

Alguns vendedores oferecem kits que incluem:
- ESP32 DevKit V1
- Protoboard
- Jumpers
- LEDs, resistores, etc.

💰 **Preço:** R$ 80 - R$ 120

Depois compre separado:
- Motores
- Sensores
- Fonte

---

## ✅ CHECKLIST DE COMPRA

Ao comprar o ESP32, verifique:

- [ ] **Modelo:** ESP32 DevKit V1 ou ESP32-WROOM-32
- [ ] **Pinos:** Mínimo 30 pinos GPIO
- [ ] **Chip:** ESP32-WROOM-32 (não S2, não C3)
- [ ] **Cores:** Dual-core (2 cores)
- [ ] **WiFi:** Sim
- [ ] **Bluetooth:** Sim (BLE 4.2)
- [ ] **Cabo USB:** Incluído ou comprar separado
- [ ] **Headers:** Soldados (pré-soldado)

---

## 🔍 COMO IDENTIFICAR SE É O CORRETO

### ✅ **CORRETO - ESP32 DevKit V1:**

```
Características visíveis:
✓ 30 pinos (15 cada lado)
✓ Porta Micro USB
✓ Chip quadrado prateado (WROOM-32)
✓ Botões: EN e BOOT
✓ LED azul onboard
✓ Escrito: "ESP32 DevKit V1" ou "ESP-WROOM-32"
```

### ❌ **ERRADO - NodeMCU ESP32:**

```
✗ 38 pinos mas layout diferente
✗ Mais largo
✗ Escrito: "NodeMCU-32S"
(Funciona, mas precisa adaptar pinout)
```

### ❌ **ERRADO - ESP32-C3:**

```
✗ Chip menor
✗ Menos pinos (22)
✗ Escrito: "ESP32-C3"
(Single core, menos potente)
```

---

## 💡 DICAS DE COMPRA

### **1. Cabo USB**
- Muitos ESP32 vêm sem cabo
- Compre cabo Micro USB
- Preço: R$ 5-10

### **2. Headers**
- Prefira com headers **pré-soldados**
- Se vier sem soldar, precisará soldar

### **3. Quantidade**
- Compre **2 unidades** (backup)
- Preço melhor em kit

### **4. Vendedor**
- Veja avaliações (mínimo 95%)
- Verifique descrição completa
- Pergunte modelo exato

### **5. Especificações**
- Confirme: "ESP32-WROOM-32"
- Confirme: "Dual-core"
- Confirme: "30 pinos" ou "38 pinos"

---

## 📱 CÓDIGO DE TESTE PÓS-COMPRA

Quando receber, teste imediatamente:

```cpp
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=== TESTE ESP32 ===");
  Serial.printf("Chip: %s\n", ESP.getChipModel());
  Serial.printf("Cores: %d\n", ESP.getChipCores());
  Serial.printf("Frequência: %d MHz\n", ESP.getCpuFreqMHz());
  Serial.printf("Flash: %d bytes\n", ESP.getFlashChipSize());
  Serial.printf("RAM livre: %d bytes\n", ESP.getFreeHeap());

  Serial.println("\n=== WiFi ===");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  int n = WiFi.scanNetworks();
  Serial.printf("Redes encontradas: %d\n", n);

  Serial.println("\n✅ ESP32 OK!");
}

void loop() {
  delay(1000);
}
```

**Resultado esperado:**
```
=== TESTE ESP32 ===
Chip: ESP32-D0WDQ6
Cores: 2
Frequência: 240 MHz
Flash: 4194304 bytes
RAM livre: ~300000 bytes

=== WiFi ===
Redes encontradas: 5+

✅ ESP32 OK!
```

---

## 🚨 PROBLEMAS COMUNS

### **Problema 1: "Device not found"**

**Solução:**
1. Instale driver CP2102 ou CH340
2. Windows: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers
3. Teste outra porta USB

### **Problema 2: Upload falha**

**Solução:**
1. Segure botão BOOT
2. Clique Upload
3. Solte após "Connecting..."

### **Problema 3: Não aparece porta serial**

**Solução:**
1. Cabo USB defeituoso (comum!)
2. Teste outro cabo
3. Verifique se é cabo de DADOS (não só carga)

---

## 🎯 RESUMO: QUAL COMPRAR?

### **Para PetFeeder:**

✅ **ESP32 DevKit V1 (30 pinos)**
- Preço: R$ 35-50
- GPIOs: 30 (suficiente)
- Fácil de encontrar
- Tutoriais abundantes

✅ **ESP32-WROOM-32 (38 pinos)**
- Preço: R$ 40-55
- GPIOs: 38 (expandível)
- Mesma qualidade

---

## 🛒 LINK DIRETO (Mercado Livre)

Busque por:
```
"ESP32 DevKit V1 30 pinos"
```

Filtros:
- Preço: R$ 30 - R$ 60
- Vendedor: Reputação verde/azul
- Localização: Seu estado (frete rápido)

---

## 📦 PACOTE COMPLETO SUGERIDO

### **Carrinho de Compras PetFeeder:**

```
ELETRÔNICOS:
[ ] 1x ESP32 DevKit V1             R$ 45
[ ] 3x Motor 28BYJ-48 + ULN2003    R$ 60
[ ] 3x Sensor HC-SR04              R$ 30
[ ] 1x RTC DS3231                  R$ 15
[ ] 1x Fonte 5V 3A                 R$ 25

CONEXÕES:
[ ] 1x Protoboard 830              R$ 15
[ ] 1x Pack jumpers 40un           R$ 10
[ ] 1x Cabo USB Micro              R$ 5

ESTRUTURA:
[ ] 1x Tubo PVC 50mm (1m)          R$ 15
[ ] 3x Potes 1L                    R$ 30

TOTAL: R$ 250
```

---

## ✅ CONCLUSÃO

**Compre:** ESP32 DevKit V1 (30 pinos)

**Onde:** Mercado Livre ou Usinainfo

**Preço:** R$ 35 - R$ 50

**Justificativa:**
- ✅ Pinos suficientes (30)
- ✅ Dual-core potente
- ✅ WiFi + Bluetooth
- ✅ Fácil de programar
- ✅ Suportado pelo firmware
- ✅ Barato e disponível

---

**🎉 Com o ESP32 DevKit V1 você tem tudo que precisa para o PetFeeder!**

**Próximo passo:** [GUIA_MOTOR_28BYJ48.md](GUIA_MOTOR_28BYJ48.md)
