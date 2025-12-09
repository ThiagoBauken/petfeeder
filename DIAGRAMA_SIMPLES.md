# 🔌 DIAGRAMA SUPER SIMPLES - Como Conectar Tudo

## 🎯 RESPOSTA RÁPIDA

**Você precisa de UMA fonte 5V 3A que alimenta TUDO através do protoboard!**

---

## 📸 VISÃO GERAL

```
        TOMADA
          │
          ▼
    ┌─────────────┐
    │  FONTE 5V   │  ← Compre esta (R$ 25)
    │     3A      │
    └──┬──────┬───┘
       │      │
      +5V    GND
       │      │
       ▼      ▼
    PROTOBOARD  ← Use trilhas de alimentação
    ═══════════
       │  │  │
       ▼  ▼  ▼
    ESP32 Motores Sensores  ← Todos recebem 5V
```

---

## 🔧 CONEXÃO PASSO A PASSO

### **PASSO 1: Fonte → Protoboard**

```
FONTE 5V 3A                 PROTOBOARD
┌──────────┐                ┌────────────────────┐
│          │                │  Trilha VERMELHA   │
│   [+]────┼────────────────┼─→ (+5V)            │
│          │                │                    │
│   [-]────┼────────────────┼─→ (GND)            │
│          │                │  Trilha AZUL       │
└──────────┘                └────────────────────┘

✅ Conecte APENAS 2 fios!
```

---

### **PASSO 2: Protoboard → ESP32**

```
PROTOBOARD                  ESP32 DevKit V1
┌────────────┐              ┌───────────────┐
│  (+5V) ────┼──────────────┤ VIN           │
│            │              │               │
│  (GND) ────┼──────────────┤ GND           │
└────────────┘              └───────────────┘

✅ ESP32 alimentado!
```

---

### **PASSO 3: Protoboard → Motor (via ULN2003)**

O motor **NÃO conecta direto** na fonte!
Você conecta o **driver ULN2003** que vem junto com o motor:

```
PROTOBOARD           ULN2003 Driver        Motor 28BYJ-48
┌────────┐           ┌────────────────┐    ┌──────────┐
│ (+5V)──┼───────────┤ + (vermelho)   │    │          │
│        │           │                ├────┤ Conector │
│ (GND)──┼───────────┤ - (preto)      │    │ branco   │
└────────┘           └────────────────┘    └──────────┘
                            ↑
                     Tem 2 conectores:
                     1. Alimentação (+ -)
                     2. Controle (IN1 IN2 IN3 IN4)

✅ Motor 1 pronto! Repita para Motor 2 e 3!
```

**Foto do ULN2003:**
```
Vista Superior do Driver ULN2003:
┌───────────────────────────────┐
│                               │
│    [Conector Motor]           │ ← Aqui entra o motor (5 pinos)
│     (5 pinos branco)          │
│                               │
│  + - IN1 IN2 IN3 IN4          │ ← Aqui entra alimentação e controle
│  │ │  │   │   │   │           │
└──┼─┼──┼───┼───┼───┼───────────┘
   │ │  │   │   │   │
   │ │  └───┴───┴───┴─── ESP32 GPIOs
   │ └── GND do Protoboard
   └─── +5V do Protoboard
```

---

### **PASSO 4: Protoboard → Sensor HC-SR04**

```
PROTOBOARD           HC-SR04
┌────────┐           ┌──────────────┐
│ (+5V)──┼───────────┤ VCC          │
│        │           │              │
│ (GND)──┼───────────┤ GND          │
└────────┘           │              │
                     │ TRIG → ESP32 │
                     │ ECHO → ESP32 │
                     └──────────────┘

✅ Sensor pronto! Repita para os 3 sensores!
```

---

## 🎨 DIAGRAMA COLORIDO

```
                 ┌──────────────┐
                 │ FONTE 5V 3A  │
                 │ (Tomada)     │
                 └───┬──────┬───┘
                     │      │
               FIO   │      │   FIO
             VERMELHO│      │  PRETO
                     ▼      ▼
        ┌─────────────────────────────┐
        │      PROTOBOARD              │
        │                              │
        │  TRILHA + ═══════════════    │ ← Vermelho
        │                              │
        │  TRILHA - ═══════════════    │ ← Azul/Preto
        │                              │
        └──┬───┬───┬───┬───┬───┬──────┘
           │   │   │   │   │   │
           ▼   ▼   ▼   ▼   ▼   ▼
         ESP32 │   │   │   │   │
               │   │   │   │   │
            Motor1 │   │   │   │
                Motor2 │   │   │
                    Motor3 │   │
                        Sensor1│
                            Sensor2
                                │
                            Sensor3
```

---

## 📦 FOTO REAL - Como Fica Montado

```
Vista de Cima do Protoboard:

┌─────────────────────────────────────────────────┐
│                                                 │
│  [Trilha +5V] ═══════════════════════════       │
│       ↑                                         │
│       └─── Fonte (+) conecta aqui              │
│                                                 │
│  [Área de Conexões]                            │
│                                                 │
│   ESP32 ┐                                       │
│   ┌─────┤  ← VIN conectado na trilha +5V       │
│   └─────┘                                       │
│                                                 │
│   ULN2003  ULN2003  ULN2003                     │
│   ┌─────┐ ┌─────┐ ┌─────┐                      │
│   │  +  │ │  +  │ │  +  │ ← Todos na trilha +5V│
│   └─────┘ └─────┘ └─────┘                      │
│                                                 │
│  [Trilha GND] ═══════════════════════════       │
│       ↑                                         │
│       └─── Fonte (-) conecta aqui              │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 💡 RESPOSTA DIRETA À SUA PERGUNTA

> "com que vou conectar a fonte dc se o motor tem fonte 5v em pinos???"

**Resposta:**

1. **O motor NÃO se conecta direto na fonte!**

2. **Sequência correta:**
   ```
   FONTE 5V
      ↓
   PROTOBOARD (distribui a energia)
      ↓
   DRIVER ULN2003 (recebe 5V nos pinos + e -)
      ↓
   MOTOR 28BYJ-48 (conecta no driver via conector branco)
   ```

3. **Você NÃO conecta fios direto no motor!**
   - O motor vem com um **conector branco de 5 pinos**
   - Esse conector **encaixa direto** no driver ULN2003
   - O driver ULN2003 é quem recebe os fios da fonte

4. **Pinos do ULN2003:**
   ```
   + (vermelho)    ← Vem do Protoboard (+5V)
   - (preto)       ← Vem do Protoboard (GND)
   IN1, IN2, IN3, IN4 ← Vem do ESP32 (GPIOs)
   ```

---

## 🔌 EXEMPLO REAL - Motor 1

```
PASSO A PASSO:

1. Pegue o driver ULN2003 do Motor 1
   (é uma plaquinha que vem junto com o motor)

2. Conecte alimentação no driver:
   Protoboard (+5V) ──┐
                      ├─→ ULN2003 pino "+"
                      │
   Protoboard (GND) ──┴─→ ULN2003 pino "-"

3. Conecte o motor no driver:
   Motor (conector branco 5 pinos) ──→ ULN2003 (conector fêmea)

   ┌────────┐
   │ Motor  │
   │28BYJ-48│
   │  │││││ │ ← Conector 5 pinos
   └──┴┴┴┴┴─┘
      │││││
      └─┬─┘
        │
        ▼
   ┌─────────┐
   │ ULN2003 │
   │ [][][]  │ ← Encaixe aqui
   └─────────┘

4. Conecte controle (ESP32 → driver):
   ESP32 GPIO13 ──→ ULN2003 IN1
   ESP32 GPIO12 ──→ ULN2003 IN2
   ESP32 GPIO14 ──→ ULN2003 IN3
   ESP32 GPIO27 ──→ ULN2003 IN4

5. PRONTO! Motor 1 conectado!
```

---

## 📊 LISTA FINAL DE FIOS NECESSÁRIOS

Para conectar TUDO, você precisa de:

| De | Para | Função | Cor Sugerida |
|----|------|--------|--------------|
| Fonte (+) | Protoboard (+5V) | Alimentação | Vermelho |
| Fonte (-) | Protoboard (GND) | Terra | Preto |
| Protoboard (+5V) | ESP32 VIN | Alimentar ESP32 | Vermelho |
| Protoboard (GND) | ESP32 GND | Terra ESP32 | Preto |
| Protoboard (+5V) | ULN2003 #1 (+) | Motor 1 | Vermelho |
| Protoboard (GND) | ULN2003 #1 (-) | Motor 1 | Preto |
| Protoboard (+5V) | ULN2003 #2 (+) | Motor 2 | Vermelho |
| Protoboard (GND) | ULN2003 #2 (-) | Motor 2 | Preto |
| Protoboard (+5V) | ULN2003 #3 (+) | Motor 3 | Vermelho |
| Protoboard (GND) | ULN2003 #3 (-) | Motor 3 | Preto |
| Protoboard (+5V) | Sensor #1 VCC | Sensor 1 | Vermelho |
| Protoboard (GND) | Sensor #1 GND | Sensor 1 | Preto |
| Protoboard (+5V) | Sensor #2 VCC | Sensor 2 | Vermelho |
| Protoboard (GND) | Sensor #2 GND | Sensor 2 | Preto |
| Protoboard (+5V) | Sensor #3 VCC | Sensor 3 | Vermelho |
| Protoboard (GND) | Sensor #3 GND | Sensor 3 | Preto |
| Protoboard (+5V) | RTC VCC | RTC | Vermelho |
| Protoboard (GND) | RTC GND | RTC | Preto |

**Total:** ~18 jumpers (9 vermelhos + 9 pretos)

---

## ✅ CHECKLIST RÁPIDO

Para garantir que está tudo certo:

- [ ] Comprei fonte 5V 3A (R$ 25)
- [ ] Comprei protoboard (R$ 15)
- [ ] Comprei jumpers (R$ 10)
- [ ] Conectei fonte nas trilhas do protoboard
- [ ] **IMPORTANTE:** Todos os + vão na MESMA trilha
- [ ] **IMPORTANTE:** Todos os - vão na MESMA trilha
- [ ] Motor conecta no **driver ULN2003**, não direto na fonte
- [ ] Driver ULN2003 conecta no protoboard (+5V e GND)
- [ ] Testei com multímetro: trilha mostra 5V

---

## 🎉 RESUMO FINAL

### **Resposta Simples:**

```
╔══════════════════════════════════════════════════╗
║                                                  ║
║  1. Fonte 5V → Protoboard (2 fios)              ║
║                                                  ║
║  2. Protoboard distribui para:                  ║
║     - ESP32 (pino VIN)                          ║
║     - 3x drivers ULN2003 (pinos + e -)          ║
║     - 3x sensores HC-SR04 (pinos VCC e GND)     ║
║     - 1x RTC DS3231 (pinos VCC e GND)           ║
║                                                  ║
║  3. Motor conecta no driver ULN2003             ║
║     (conector branco de 5 pinos)                ║
║                                                  ║
║  TUDO usa a MESMA fonte 5V!                     ║
║                                                  ║
╚══════════════════════════════════════════════════╝
```

### **Custo Total:**
- Fonte 5V 3A: R$ 25
- Protoboard: R$ 15
- Jumpers: R$ 10
- **TOTAL: R$ 50**

---

**⚡ AGORA FICOU CLARO?**

Se ainda tiver dúvida, me pergunte! 😊

---

**Próximo:** Leia o [GUIA_ALIMENTACAO_ELETRICA.md](GUIA_ALIMENTACAO_ELETRICA.md) para detalhes completos
