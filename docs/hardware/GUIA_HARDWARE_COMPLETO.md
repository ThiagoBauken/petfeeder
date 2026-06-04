# 🔧 GUIA COMPLETO DE HARDWARE - PetFeeder ESP32

## 📦 LISTA DE MATERIAIS NECESSÁRIOS

### **Componentes Principais:**

| Item | Quantidade | Especificação | Preço Aprox. |
|------|------------|---------------|--------------|
| ESP32 DevKit | 1 | 38 pinos | R$ 35 |
| Motor 28BYJ-48 | 1-3 | 5V Step Motor | R$ 15 cada |
| Driver ULN2003 | 1-3 | Para cada motor | R$ 8 cada |
| RTC DS3231 | 1 | Módulo com bateria | R$ 12 |
| Sensor HC-SR04 | 1-3 | Ultrassônico | R$ 5 cada |
| Fonte 5V 3A | 1 | Alimentação geral | R$ 20 |
| Bateria CR2032 | 1 | Para RTC | R$ 5 |
| Cabos Jumper | 20 | Macho-Fêmea | R$ 10 |
| Protoboard | 1 | Opcional (teste) | R$ 15 |

**TOTAL: R$ 150 - R$ 250** (dependendo de 1 ou 3 motores)

---

## 🔌 ALIMENTAÇÃO - QUEM ALIMENTA O QUÊ

### ⚡ **IMPORTANTE: REGRAS DE ALIMENTAÇÃO**

```
┌──────────────────────────────────────────────────┐
│  FONTE 5V 3A (EXTERNA)                          │
│                                                  │
│  ├─→ ESP32 (Pino VIN ou 5V)    → 500mA          │
│  ├─→ Motor 1 (via ULN2003)     → 200-500mA      │
│  ├─→ Motor 2 (via ULN2003)     → 200-500mA      │
│  ├─→ Motor 3 (via ULN2003)     → 200-500mA      │
│  └─→ RTC DS3231                → 5mA             │
│                                                  │
│  TOTAL: ~1.5A (pode chegar a 2.5A com 3 motores)│
└──────────────────────────────────────────────────┘
```

### ❌ **NUNCA FAÇA ISSO:**
- ❌ **Alimentar motores pelo ESP32** - ESP32 fornece apenas 500mA max, motor precisa de 200-500mA CADA
- ❌ **Alimentar ESP32 pela USB durante uso** - USB fornece apenas 500mA, insuficiente para motores
- ❌ **Conectar motores direto no ESP32** - Você vai queimar o ESP32!

### ✅ **FAÇA ASSIM:**

```
FONTE 5V 3A
    ├── Fio VERMELHO (+5V) ────┬─→ ESP32 (VIN)
    │                          ├─→ ULN2003 Motor 1 (+5V)
    │                          ├─→ ULN2003 Motor 2 (+5V)
    │                          ├─→ ULN2003 Motor 3 (+5V)
    │                          └─→ RTC DS3231 (VCC)
    │
    └── Fio PRETO (GND) ───────┬─→ ESP32 (GND)
                               ├─→ ULN2003 Motor 1 (GND)
                               ├─→ ULN2003 Motor 2 (GND)
                               ├─→ ULN2003 Motor 3 (GND)
                               └─→ RTC DS3231 (GND)
```

**RESUMO:**
- ✅ **Fonte 5V 3A** alimenta TUDO (ESP32 + Motores + RTC)
- ✅ **ESP32** apenas CONTROLA os motores (sinais digitais)
- ✅ **ULN2003** liga/desliga as bobinas do motor
- ✅ **GND comum** para todos os componentes

---

## 🔧 CONEXÕES FÍSICAS - PASSO A PASSO

### **1. MOTOR 28BYJ-48 + ULN2003**

#### O motor 28BYJ-48 já vem com:
- ✅ **Conector fêmea de 5 pinos** (cabo fixo no motor)
- ✅ Cabo flat de ~20cm
- ✅ Cores: Vermelho, Laranja, Amarelo, Rosa, Azul

#### O driver ULN2003 tem:
- ✅ **Conector macho de 5 pinos** para o motor (você ENCAIXA direto!)
- ✅ 4 pinos IN1, IN2, IN3, IN4 (para o ESP32)
- ✅ Pinos GND e VCC para alimentação

**VOCÊ NÃO PRECISA SOLDAR NADA NO MOTOR!**

```
┌──────────────────────────────────────────┐
│  Motor 28BYJ-48                          │
│  (com conector fêmea de 5 pinos)         │
│                                          │
│   Cabo com 5 fios:                       │
│   🔴 Vermelho  (VCC)                     │
│   🟠 Laranja   (Bobina 1)                │
│   🟡 Amarelo   (Bobina 2)                │
│   🌸 Rosa      (Bobina 3)                │
│   🔵 Azul      (Bobina 4)                │
│         │                                │
│         └──────→ ENCAIXA DIRETO          │
│                                          │
│   ┌────────────────────────────┐         │
│   │  ULN2003 Driver            │         │
│   │  Conector macho 5 pinos    │         │
│   └────────────────────────────┘         │
└──────────────────────────────────────────┘
```

### **2. CONEXÕES DO ULN2003 → ESP32**

Cada driver ULN2003 tem 4 pinos de controle que vão para o ESP32:

#### **Motor 1:**
```
ULN2003 (Motor 1)          ESP32
├── IN1 ────────────────→  GPIO 13
├── IN2 ────────────────→  GPIO 12
├── IN3 ────────────────→  GPIO 14
└── IN4 ────────────────→  GPIO 27
├── VCC ────────────────→  Fonte 5V (+)
└── GND ────────────────→  Fonte GND (-)
```

#### **Motor 2 (Opcional):**
```
ULN2003 (Motor 2)          ESP32
├── IN1 ────────────────→  GPIO 26
├── IN2 ────────────────→  GPIO 25
├── IN3 ────────────────→  GPIO 33
└── IN4 ────────────────→  GPIO 32
├── VCC ────────────────→  Fonte 5V (+)
└── GND ────────────────→  Fonte GND (-)
```

#### **Motor 3 (Opcional):**
```
ULN2003 (Motor 3)          ESP32
├── IN1 ────────────────→  GPIO 15
├── IN2 ────────────────→  GPIO 2
├── IN3 ────────────────→  GPIO 4
└── IN4 ────────────────→  GPIO 5
├── VCC ────────────────→  Fonte 5V (+)
└── GND ────────────────→  Fonte GND (-)
```

### **3. RTC DS3231 → ESP32**

```
RTC DS3231                 ESP32
├── VCC ────────────────→  Fonte 5V (+)
├── GND ────────────────→  Fonte GND (-)
├── SDA ────────────────→  GPIO 21 (I2C SDA)
└── SCL ────────────────→  GPIO 22 (I2C SCL)

🔋 Bateria CR2032: Encaixe no holder do módulo RTC
```

### **4. Sensor HC-SR04 → ESP32 (Opcional)**

Para medir nível de ração:

#### **Sensor 1:**
```
HC-SR04 (Sensor 1)         ESP32
├── VCC ────────────────→  Fonte 5V (+)
├── GND ────────────────→  Fonte GND (-)
├── TRIG ───────────────→  GPIO 19
└── ECHO ───────────────→  GPIO 18
```

#### **Sensor 2 (Opcional):**
```
HC-SR04 (Sensor 2)         ESP32
├── TRIG ───────────────→  GPIO 23
└── ECHO ───────────────→  GPIO 22
```

#### **Sensor 3 (Opcional):**
```
HC-SR04 (Sensor 3)         ESP32
├── TRIG ───────────────→  GPIO 16
└── ECHO ───────────────→  GPIO 17
```

---

## 🛠️ MONTAGEM PASSO A PASSO

### **Opção 1: Montagem em Protoboard (Teste)**

```
1. Coloque o ESP32 na protoboard
2. Encaixe os motores nos drivers ULN2003
3. Conecte os drivers à protoboard
4. Conecte jumpers dos drivers → ESP32
5. Conecte RTC à protoboard
6. Conecte jumpers do RTC → ESP32
7. Conecte fonte 5V:
   - Fio vermelho (+5V) → trilha positiva da protoboard
   - Fio preto (GND) → trilha negativa da protoboard
8. Distribua alimentação para todos os componentes
```

### **Opção 2: Montagem Definitiva (Solda)**

#### **O QUE SOLDAR:**

**1. Alimentação Principal:**
```
Componente a soldar: BARRA DE PINOS (header bar)

   ┌─────────────────────────────────────┐
   │  Barra de pinos 2x8 (macho)         │
   │  Soldar no ESP32 (se não vier)      │
   └─────────────────────────────────────┘

   OU

   ┌─────────────────────────────────────┐
   │  Conector KRE 2.54mm (fêmea)        │
   │  Para criar "shield" removível       │
   └─────────────────────────────────────┘
```

**2. Conexões dos Motores:**
```
OPÇÃO A: Usar jumpers fêmea-macho (sem solda)
   ULN2003 (pinos macho) ← jumper fêmea-macho → ESP32

OPÇÃO B: Soldar fios diretamente
   1. Corte 4 fios de ~15cm (cores diferentes)
   2. Descasque 5mm de cada ponta
   3. Solde uma ponta nos pinos IN1-IN4 do ULN2003
   4. Solde a outra ponta nos GPIOs do ESP32
```

**3. Placa de Circuito Impresso (PCB) - Profissional:**
```
Se quiser fazer PCB personalizada:
   - Use software: KiCad, EasyEDA, Fritzing
   - Desenhe o circuito conforme diagrama
   - Exporte Gerber files
   - Encomende em: JLCPCB, PCBWay (R$ 2/un + frete)
```

---

## 📐 DIAGRAMA DE PINOS DO ESP32

```
                    ┌─────────────┐
                    │             │
                    │   ESP32     │
                    │  DevKit 38  │
                    │             │
         3V3  [1]   │●           ●│  [38] GND
         GND  [2]   │●           ●│  [37] GPIO 23 → HC-SR04 #2 TRIG
     GPIO 15  [3]   │●  ESP32    ●│  [36] GPIO 22 → I2C SCL (RTC)
      GPIO 2  [4]   │●           ●│  [35] TX0
      GPIO 4  [5]   │●           ●│  [34] RX0
     GPIO 16  [6]   │●           ●│  [33] GPIO 21 → I2C SDA (RTC)
     GPIO 17  [7]   │●           ●│  [32] GND
      GPIO 5  [8]   │●           ●│  [31] GPIO 19 → HC-SR04 #1 TRIG
     GPIO 18  [9]   │●           ●│  [30] GPIO 18 → HC-SR04 #1 ECHO
     GPIO 19  [10]  │●           ●│  [29] GPIO 5  → Motor 3 IN4
         GND  [11]  │●           ●│  [28] GPIO 17 → HC-SR04 #3 ECHO
     GPIO 21  [12]  │●           ●│  [27] GPIO 16 → HC-SR04 #3 TRIG
      RX2     [13]  │●           ●│  [26] GPIO 4  → Motor 3 IN3
      TX2     [14]  │●           ●│  [25] GPIO 2  → Motor 3 IN2
     GPIO 22  [15]  │●           ●│  [24] GPIO 15 → Motor 3 IN1
     GPIO 23  [16]  │●           ●│  [23] GND
         GND  [17]  │●           ●│  [22] GPIO 13 → Motor 1 IN1
         3V3  [18]  │●           ●│  [21] GPIO 12 → Motor 1 IN2
         EN   [19]  │●           ●│  [20] GPIO 14 → Motor 1 IN3
                    │●           ●│
         SVP  [20]  │●           ●│  [19] GPIO 27 → Motor 1 IN4
         SVN  [21]  │●           ●│  [18] GPIO 26 → Motor 2 IN1
     GPIO 34  [22]  │●           ●│  [17] GPIO 25 → Motor 2 IN2
     GPIO 35  [23]  │●           ●│  [16] GPIO 33 → Motor 2 IN3
     GPIO 32  [24]  │●           ●│  [15] GPIO 32 → Motor 2 IN4
     GPIO 33  [25]  │●           ●│  [14] GPIO 35
     GPIO 25  [26]  │●           ●│  [13] GPIO 34
     GPIO 26  [27]  │●           ●│  [12] VN
     GPIO 27  [28]  │●           ●│  [11] VP
     GPIO 14  [29]  │●           ●│  [10] GPIO 39
     GPIO 12  [30]  │●           ●│  [09] GPIO 36
         GND  [31]  │●           ●│  [08] EN
     GPIO 13  [32]  │●           ●│  [07] GPIO 3V3
        SHD   [33]  │●           ●│  [06] GND
        SWP   [34]  │●           ●│  [05] GND
        SCS   [35]  │●           ●│  [04] GPIO 5V (VIN)
        SCK   [36]  │●           ●│  [03] CMD
        SDO   [37]  │●           ●│  [02] SD3
        SDI   [38]  │●           ●│  [01] SD2
                    └─────────────┘

LEGENDA:
● = Pino disponível
→ = Conexão para o componente
```

---

## 🔌 ESQUEMA ELÉTRICO COMPLETO

```
┌─────────────────────────────────────────────────────────────────┐
│                     FONTE 5V 3A (EXTERNA)                       │
│                                                                 │
│  Positivo (+5V) ────┬────────────────────────────────────────┐  │
│                     │                                        │  │
│  Negativo (GND) ────┼────────────────────────────────────┐   │  │
└─────────────────────┼────────────────────────────────────┼───┼──┘
                      │                                    │   │
        ┌─────────────┴───────────┐                        │   │
        │                         │                        │   │
        ▼                         ▼                        │   │
   ┌─────────┐            ┌──────────────┐                │   │
   │ ESP32   │            │  ULN2003 #1  │                │   │
   │         │            │   (Motor 1)  │                │   │
   │ VIN ←───┼────────────┤ VCC          │                │   │
   │         │            │              │                │   │
   │ GND ←───┼────────────┤ GND          │                │   │
   │         │            │              │                │   │
   │ GPIO13 ─┼───────────→│ IN1          │                │   │
   │ GPIO12 ─┼───────────→│ IN2          │     Motor      │   │
   │ GPIO14 ─┼───────────→│ IN3   OUT ───┼──→ 28BYJ-48 #1 │   │
   │ GPIO27 ─┼───────────→│ IN4          │                │   │
   │         │            └──────────────┘                │   │
   │         │                                            │   │
   │         │            ┌──────────────┐                │   │
   │         │            │  ULN2003 #2  │                │   │
   │         │            │   (Motor 2)  │                │   │
   │         │            │ VCC ←────────┼────────────────┘   │
   │         │            │ GND ←────────┼────────────────────┘
   │         │            │              │
   │ GPIO26 ─┼───────────→│ IN1          │
   │ GPIO25 ─┼───────────→│ IN2          │     Motor
   │ GPIO33 ─┼───────────→│ IN3   OUT ───┼──→ 28BYJ-48 #2
   │ GPIO32 ─┼───────────→│ IN4          │
   │         │            └──────────────┘
   │         │
   │         │            ┌──────────────┐
   │         │            │  RTC DS3231  │
   │         │            │              │
   │         │            │ VCC ←────────┼────────────────┐
   │         │            │ GND ←────────┼────────────────┼───┐
   │         │            │              │                │   │
   │ GPIO21 ─┼───────────→│ SDA (I2C)    │                │   │
   │ GPIO22 ─┼───────────→│ SCL (I2C)    │                │   │
   │         │            │              │                │   │
   │         │            │ 🔋 CR2032     │                │   │
   │         │            └──────────────┘                │   │
   │         │                                            │   │
   │         │            ┌──────────────┐                │   │
   │         │            │  HC-SR04 #1  │                │   │
   │         │            │              │                │   │
   │         │            │ VCC ←────────┼────────────────┘   │
   │         │            │ GND ←────────┼────────────────────┘
   │         │            │              │
   │ GPIO19 ─┼───────────→│ TRIG         │
   │ GPIO18 ─┼──────────→←│ ECHO         │
   └─────────┘            └──────────────┘

TODAS AS ALIMENTAÇÕES (VCC) VÊM DA FONTE 5V
TODOS OS GROUNDS (GND) CONECTAM À FONTE GND
```

---

## 💡 DICAS IMPORTANTES

### **Cabos e Fios:**
- ✅ Use cores diferentes para cada sinal (facilita debug)
- ✅ Vermelho = +5V, Preto/Marrom = GND (padrão)
- ✅ Use fita isolante ou termo-retrátil nas soldas
- ✅ Deixe folga nos cabos (não estique!)

### **Montagem:**
- ✅ Teste PRIMEIRO na protoboard antes de soldar
- ✅ Conecte um motor de cada vez e teste
- ✅ Use multímetro para verificar continuidade
- ✅ Não conecte alimentação com ESP32 ligado na USB

### **Segurança:**
- ⚠️ Desconecte alimentação antes de mexer nos fios
- ⚠️ Verifique polaridade antes de ligar (VCC/GND)
- ⚠️ Não toque nos componentes enquanto ligados
- ⚠️ Use óculos de proteção ao soldar

---

## 📦 LISTA DE COMPRAS (Links Úteis)

### **Kit Completo Sugerido:**
1. **ESP32 DevKit 38 pinos** - Mercado Livre, AliExpress
2. **Motor 28BYJ-48 + ULN2003** - Geralmente vem em KIT
3. **RTC DS3231 com bateria** - Inclui CR2032
4. **Fonte 5V 3A** - Fontes de roteador servem!
5. **HC-SR04** - Pack com 3 unidades
6. **Jumpers** - Pack com 40 fios M-F, M-M, F-F
7. **Protoboard 830 pontos** - Para testes

### **Ferramentas:**
- Ferro de solda 30W-60W
- Solda 0.8mm (com fluxo)
- Sugador de solda / malha dessoldadora
- Alicate de corte
- Multímetro digital
- Chave Philips pequena

---

## ✅ CHECKLIST ANTES DE LIGAR

Antes de conectar a fonte pela primeira vez:

- [ ] Verifiquei todas as conexões VCC (+5V)
- [ ] Verifiquei todas as conexões GND
- [ ] Não há curto-circuito entre VCC e GND (multímetro)
- [ ] Motores encaixados corretamente nos drivers
- [ ] RTC tem bateria CR2032 instalada
- [ ] Fonte é 5V (não 9V ou 12V!)
- [ ] Cabo USB do ESP32 DESCONECTADO (usar só fonte)
- [ ] Código já foi carregado no ESP32

**SÓ DEPOIS DISSO:** Conecte a fonte 5V!

---

## 🎯 RESUMO FINAL

### **VOCÊ NÃO PRECISA SOLDAR NO MOTOR!**
- ✅ Motor 28BYJ-48 já vem com conector
- ✅ Só encaixe no ULN2003

### **O QUE SOLDAR (OPCIONAL):**
- Pinos no ESP32 (se não vier)
- Fios dos ULN2003 → ESP32 (ou use jumpers)
- Fios do RTC → ESP32 (ou use jumpers)
- Fios da fonte → barramento de alimentação

### **ALIMENTAÇÃO:**
- ✅ Fonte 5V 3A alimenta TUDO
- ✅ ESP32 apenas CONTROLA
- ✅ ULN2003 LIGA/DESLIGA as bobinas
- ❌ ESP32 NÃO alimenta motores!

**Pronto! Com isso você monta o hardware completo!** 🎉
