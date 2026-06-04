# ⚡ GUIA COMPLETO - Alimentação Elétrica do PetFeeder

## 🎯 O PROBLEMA

Você tem **VÁRIOS componentes** que precisam de energia:

| Componente | Tensão | Corrente |
|-----------|--------|----------|
| ESP32 DevKit V1 | 5V (VIN) ou 3.3V | 500mA (pico) |
| Motor 28BYJ-48 + ULN2003 #1 | 5V | 200mA |
| Motor 28BYJ-48 + ULN2003 #2 | 5V | 200mA |
| Motor 28BYJ-48 + ULN2003 #3 | 5V | 200mA |
| Sensor HC-SR04 #1 | 5V | 15mA |
| Sensor HC-SR04 #2 | 5V | 15mA |
| Sensor HC-SR04 #3 | 5V | 15mA |
| RTC DS3231 | 3.3V ou 5V | 0.5mA |
| **TOTAL** | **5V** | **~1.2A** |

**A questão:** Como conectar UMA fonte 5V para alimentar TUDO?

---

## ✅ SOLUÇÃO: Distribuição de Energia

Use **UMA fonte 5V 3A** e distribua para todos os componentes:

```
┌──────────────────────────────────────────────────────────┐
│              FONTE 5V 3A (AC/DC)                         │
│         ┌────────────────────────────┐                   │
│         │  Input: 110-220V AC        │                   │
│         │  Output: 5V DC 3A          │                   │
│         └────────┬──────────┬────────┘                   │
│                  │          │                            │
│                 (+)        (-)                           │
└──────────────────┼──────────┼───────────────────────────┘
                   │          │
                   │          │
         ┌─────────┴──────────┴──────────┐
         │   BARRA DE DISTRIBUIÇÃO        │
         │   (ou Protoboard)              │
         │                                │
         │  (+5V)  (GND)                  │
         └───┬──────┬────────────────────┘
             │      │
             ├──────┼──────┐──────┐──────┐──────┐──────┐
             │      │      │      │      │      │      │
             ▼      ▼      ▼      ▼      ▼      ▼      ▼
           ESP32  Motor1 Motor2 Motor3  Sens1  Sens2  Sens3
           (VIN)  (ULN)  (ULN)  (ULN)  (VCC)  (VCC)  (VCC)
```

---

## 🔌 CONEXÕES DETALHADAS

### **1. FONTE 5V 3A → Protoboard:**

```
Fonte 5V 3A
┌────────────────┐
│  AC 110-220V   │ ← Tomada
│  ↓             │
│  DC 5V 3A      │
│  [+]  [-]      │
└──┬────┬────────┘
   │    │
   │    └─────────────────────────┐
   │                              │
   ▼                              ▼
Protoboard                    Protoboard
Trilha (+)                    Trilha (-)
VERMELHO                      PRETO/AZUL
```

### **2. Protoboard → ESP32 DevKit V1:**

```
Protoboard          ESP32 DevKit V1
┌──────┐            ┌──────────────┐
│ +5V  ├────────────┤ VIN          │
│      │            │              │
│ GND  ├────────────┤ GND          │
└──────┘            └──────────────┘

✅ ESP32 alimentado!
```

### **3. Protoboard → Motor 28BYJ-48 (via ULN2003):**

Cada motor tem um **driver ULN2003** que precisa de 5V:

```
Protoboard          ULN2003 Driver      Motor 28BYJ-48
┌──────┐            ┌──────────────┐    ┌─────────┐
│ +5V  ├────────────┤ + (5V)       │    │         │
│      │            │              ├────┤ Conector│
│ GND  ├────────────┤ - (GND)      │    │ 5 pinos │
└──────┘            │              │    └─────────┘
                    │ IN1 ← ESP32 GPIO13
                    │ IN2 ← ESP32 GPIO12
                    │ IN3 ← ESP32 GPIO14
                    │ IN4 ← ESP32 GPIO27
                    └──────────────┘

✅ Motor 1 alimentado e controlado!
```

**Repita para Motor 2 e Motor 3** com seus respectivos GPIOs!

### **4. Protoboard → Sensor HC-SR04:**

```
Protoboard          HC-SR04
┌──────┐            ┌──────────────┐
│ +5V  ├────────────┤ VCC          │
│      │            │              │
│ GND  ├────────────┤ GND          │
└──────┘            │              │
                    │ TRIG ← ESP32 GPIO19
                    │ ECHO → Divisor → ESP32 GPIO18
                    └──────────────┘

✅ Sensor 1 alimentado!
```

**Repita para Sensor 2 e Sensor 3!**

### **5. Protoboard → RTC DS3231:**

```
Protoboard          RTC DS3231
┌──────┐            ┌──────────────┐
│ +5V  ├────────────┤ VCC (5V)     │
│      │            │              │
│ GND  ├────────────┤ GND          │
└──────┘            │              │
                    │ SDA ← ESP32 GPIO21
                    │ SCL ← ESP32 GPIO22
                    └──────────────┘

✅ RTC alimentado!
```

---

## 📊 ESQUEMA COMPLETO DE ALIMENTAÇÃO

```
                    ┌─────────────────────┐
                    │   FONTE 5V 3A       │
                    │   AC → DC           │
                    └──────┬──────┬───────┘
                           │      │
                          +5V    GND
                           │      │
        ┌──────────────────┴──────┴───────────────────────┐
        │                                                  │
        │              PROTOBOARD (Power Rails)            │
        │                                                  │
        │  (+5V) ═════════════════════════════════════    │
        │                                                  │
        │  (GND) ═════════════════════════════════════    │
        │                                                  │
        └─────┬────┬────┬────┬────┬────┬────┬────────────┘
              │    │    │    │    │    │    │
              ▼    ▼    ▼    ▼    ▼    ▼    ▼
            ESP32 ULN1 ULN2 ULN3 SEN1 SEN2 SEN3
            (VIN) (5V) (5V) (5V) (5V) (5V) (5V)
              │    │    │    │    │    │    │
              ▼    ▼    ▼    ▼    ▼    ▼    ▼
            (GND) (GND)(GND)(GND)(GND)(GND)(GND)
              │    │    │    │    │    │    │
              └────┴────┴────┴────┴────┴────┴───── GND Rail
```

---

## 🔧 PASSO A PASSO PRÁTICO

### **1. Preparar a Protoboard:**

```
1. Identifique as trilhas de alimentação:
   - Trilha superior VERMELHA = +5V
   - Trilha superior AZUL/PRETA = GND

2. Conecte jumpers:
   - Fonte (+) → Trilha VERMELHA (+5V)
   - Fonte (-) → Trilha AZUL (GND)
```

### **2. Conectar ESP32:**

```
1. Pegue 2 jumpers:
   - Jumper VERMELHO: Trilha +5V → ESP32 VIN
   - Jumper PRETO: Trilha GND → ESP32 GND

2. Insira no protoboard
```

### **3. Conectar cada Motor (ULN2003):**

```
Para CADA motor:

1. ULN2003 tem 2 conectores:
   ┌─────────────────────┐
   │                     │
   │  [Conector Motor]   │ ← Motor 28BYJ-48 (5 pinos)
   │                     │
   │  + - IN1 IN2 IN3 IN4│ ← Pinos de controle
   └─────────────────────┘

2. Conecte alimentação:
   - Trilha +5V → ULN2003 (+)
   - Trilha GND → ULN2003 (-)

3. Conecte controle (GPIO do ESP32):
   - ESP32 GPIO → ULN2003 IN1/IN2/IN3/IN4
```

### **4. Conectar cada Sensor HC-SR04:**

```
Para CADA sensor:

HC-SR04 tem 4 pinos:
[VCC] [TRIG] [ECHO] [GND]

1. Conecte alimentação:
   - Trilha +5V → HC-SR04 VCC
   - Trilha GND → HC-SR04 GND

2. Conecte controle:
   - ESP32 GPIO → HC-SR04 TRIG (direto)
   - ESP32 GPIO ← HC-SR04 ECHO (via divisor de tensão!)
```

### **5. Conectar RTC DS3231:**

```
RTC DS3231 tem 4 pinos:
[VCC] [GND] [SDA] [SCL]

1. Conecte alimentação:
   - Trilha +5V → RTC VCC
   - Trilha GND → RTC GND

2. Conecte I2C:
   - ESP32 GPIO21 → RTC SDA
   - ESP32 GPIO22 → RTC SCL
```

---

## ⚡ ESPECIFICAÇÕES DA FONTE

### **O que comprar:**

| Característica | Valor Mínimo | Recomendado |
|---------------|--------------|-------------|
| **Tensão de Saída** | 5V DC | 5V DC |
| **Corrente** | 2A | 3A |
| **Entrada** | 110-220V AC | 110-220V AC |
| **Conector** | Plug P4 ou fios | Fios destacáveis |
| **Preço** | R$ 15 | R$ 25 |

### **Modelos Recomendados:**

1. **Fonte Chaveada 5V 3A** (Melhor opção)
   - Modelo: Fonte 5V 3A P4
   - Preço: R$ 20-30
   - Onde: Mercado Livre, Usinainfo

2. **Carregador USB 5V 2A** (Alternativa econômica)
   - Modelo: Carregador celular antigo
   - Preço: R$ 10-15 (ou grátis se tiver)
   - Corte o cabo USB e use os fios

3. **Fonte Arduino 5V 2A** (Alternativa)
   - Modelo: Fonte para Arduino
   - Preço: R$ 15-25
   - Onde: Mercado Livre

---

## 🔌 TIPOS DE CONECTORES

### **Opção 1: Fonte com Plug P4** (Recomendado)

```
Fonte            Adaptador P4 → Fios
┌──────┐         ┌──────────────────┐
│  AC  │         │   ╱─────╲        │
│  ↓   │    ───► │  │  P4  │        │
│  5V  │         │   ╲─────╱        │
│  [P4]├─────────┤                  │
└──────┘         │   Fio+ Fio-      │
                 └────┬──────┬──────┘
                      │      │
                      ▼      ▼
                    +5V     GND
```

**Vantagem:** Desconecta fácil, profissional

### **Opção 2: Fonte com Fios Diretos**

```
Fonte
┌──────────┐
│   AC     │
│   ↓      │
│   5V     │
│  [+] [-] │
└───┬───┬──┘
    │   │
    ▼   ▼
  +5V  GND
```

**Vantagem:** Mais barata, conexão direta

### **Opção 3: Carregador USB Modificado**

```
Carregador USB      Cortar e Descascar
┌──────────┐        ┌──────────────────┐
│   AC     │        │  USB Macho       │
│   ↓      │    ──► │  ┌────────┐      │
│   5V     │        │  │ cortar │      │
│  [USB]   ├────────┤  └────────┘      │
└──────────┘        │                  │
                    │  Fio Vermelho = +5V
                    │  Fio Preto = GND
                    └──────────────────┘
```

**Vantagem:** Grátis se tiver carregador velho

---

## 🛒 LISTA DE COMPRAS - ALIMENTAÇÃO

| Item | Quantidade | Preço | Onde Comprar |
|------|-----------|-------|--------------|
| **Fonte 5V 3A** | 1 | R$ 25 | Mercado Livre |
| **Protoboard 830 pontos** | 1 | R$ 15 | Mercado Livre |
| **Jumpers M-M (40 pcs)** | 1 | R$ 10 | Mercado Livre |
| **Resistor 1kΩ** | 3 | R$ 0,30 | Loja eletrônica |
| **Resistor 2kΩ** | 3 | R$ 0,30 | Loja eletrônica |
| **TOTAL** | - | **R$ 50** | - |

---

## ⚠️ CUIDADOS IMPORTANTES

### **1. NUNCA alimente motores pelo USB do ESP32!**

```
❌ ERRADO:
ESP32 USB ──┐
            ├─→ Motores
ESP32 VIN ──┘
(Queima o ESP32!)

✅ CORRETO:
Fonte 5V ──┬─→ ESP32 VIN
           └─→ ULN2003 (+)
```

### **2. GND Comum é OBRIGATÓRIO!**

```
✅ Todos os GNDs conectados:
- ESP32 GND
- ULN2003 GND (todos)
- Sensores GND (todos)
- RTC GND
- Fonte GND

Formam UMA ÚNICA trilha GND!
```

### **3. Divisor de Tensão no ECHO do HC-SR04:**

```
HC-SR04 ECHO (5V) ──┬─── 1kΩ ───┬─── ESP32 GPIO
                    │           │
                   2kΩ          │
                    │           │
                   GND          │
                               3.3V ✅
```

**Por que?** ESP32 aceita apenas 3.3V nos GPIOs!

---

## 🔋 CONSUMO TOTAL E AUTONOMIA

### **Consumo por Componente:**

```
ESP32 (WiFi ativo):     240mA
Motor 1 (girando):      200mA
Motor 2 (girando):      200mA
Motor 3 (girando):      200mA
Sensor 1:                15mA
Sensor 2:                15mA
Sensor 3:                15mA
RTC:                    0.5mA
────────────────────────────
TOTAL (tudo ligado):    885mA ≈ 0.9A

TOTAL (uso normal):     ~400mA ≈ 0.4A
```

### **Autonomia com Bateria:**

```
Power Bank 10.000mAh:
10.000mAh / 400mA = 25 horas ≈ 1 dia

Bateria 18650 (3000mAh):
3000mAh / 400mA = 7.5 horas

4x Bateria 18650 (12.000mAh):
12.000mAh / 400mA = 30 horas ≈ 1.2 dias
```

---

## 🎯 ESQUEMA VISUAL COMPLETO

```
┌───────────────────────────────────────────────────────────┐
│                      TOMADA 110/220V                      │
└──────────────────────────┬────────────────────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │  FONTE 5V 3A         │
                │  (AC → DC)           │
                └──────┬──────┬────────┘
                       │      │
                      +5V    GND
                       │      │
        ┌──────────────┴──────┴──────────────────┐
        │         PROTOBOARD                     │
        │                                        │
        │  (+) ══════════════════════════        │
        │                                        │
        │  (-) ══════════════════════════        │
        └─┬───┬───┬───┬───┬───┬───┬────────────┘
          │   │   │   │   │   │   │
          ▼   ▼   ▼   ▼   ▼   ▼   ▼
        ┌────────────────────────────────────┐
        │      ESP32 DevKit V1               │
        │  VIN ← +5V                         │
        │  GND ← GND                         │
        │  GPIO13,12,14,27 → ULN2003 #1      │
        │  GPIO26,25,33,32 → ULN2003 #2      │
        │  GPIO15,2,4,5 → ULN2003 #3         │
        │  GPIO19,18 → HC-SR04 #1            │
        │  GPIO23,22 → HC-SR04 #2            │
        │  GPIO16,17 → HC-SR04 #3            │
        │  GPIO21,22 → RTC DS3231            │
        └────────────────────────────────────┘

        ┌────────────┬────────────┬────────────┐
        │  ULN2003   │  ULN2003   │  ULN2003   │
        │  Driver #1 │  Driver #2 │  Driver #3 │
        │            │            │            │
        │  +5V ← +5V │  +5V ← +5V │  +5V ← +5V │
        │  GND ← GND │  GND ← GND │  GND ← GND │
        │     ↓      │     ↓      │     ↓      │
        │  Motor 1   │  Motor 2   │  Motor 3   │
        └────────────┴────────────┴────────────┘

        ┌────────────┬────────────┬────────────┐
        │ HC-SR04 #1 │ HC-SR04 #2 │ HC-SR04 #3 │
        │            │            │            │
        │  VCC ← +5V │  VCC ← +5V │  VCC ← +5V │
        │  GND ← GND │  GND ← GND │  GND ← GND │
        └────────────┴────────────┴────────────┘

        ┌────────────┐
        │ RTC DS3231 │
        │            │
        │  VCC ← +5V │
        │  GND ← GND │
        └────────────┘
```

---

## 🔧 TESTE DE ALIMENTAÇÃO

Antes de conectar tudo, teste a fonte:

```bash
1. Conecte a fonte na tomada
2. Use um multímetro:
   - Ponta vermelha no (+)
   - Ponta preta no (-)
3. Leia a tensão: deve ser ~5V (4.8V a 5.2V OK)

Se mostrar 0V → Fonte com problema
Se mostrar 12V → Fonte errada!
Se mostrar 4.5V-5.5V → ✅ OK!
```

---

## ✅ CHECKLIST DE MONTAGEM

- [ ] Comprei fonte 5V 3A
- [ ] Testei tensão com multímetro (5V ✓)
- [ ] Conectei fonte nas trilhas do protoboard
- [ ] Conectei ESP32 VIN e GND
- [ ] Conectei todos os ULN2003 (+5V e GND)
- [ ] Conectei todos os sensores (VCC e GND)
- [ ] Conectei RTC (VCC e GND)
- [ ] Todos os GNDs estão conectados juntos
- [ ] Divisor de tensão instalado nos ECHO dos sensores
- [ ] Liguei a fonte e testei

---

## 🎉 RESUMO

### **Resposta Simples:**

```
FONTE 5V 3A
    │
    ├─→ Protoboard (+5V e GND)
    │
    ├─→ ESP32 (VIN e GND)
    ├─→ Motor 1 ULN2003 (+ e -)
    ├─→ Motor 2 ULN2003 (+ e -)
    ├─→ Motor 3 ULN2003 (+ e -)
    ├─→ Sensor 1 (VCC e GND)
    ├─→ Sensor 2 (VCC e GND)
    ├─→ Sensor 3 (VCC e GND)
    └─→ RTC (VCC e GND)

TODOS compartilham a MESMA fonte 5V!
```

### **Custo Total Alimentação:**

- Fonte 5V 3A: R$ 25
- Protoboard: R$ 15
- Jumpers: R$ 10
- Resistores: R$ 1
- **TOTAL: R$ 51**

---

**⚡ COM ESTA CONFIGURAÇÃO, TUDO FUNCIONA PERFEITAMENTE!**

**Próximo:** [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)
