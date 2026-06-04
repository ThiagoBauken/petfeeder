# ⚡ CONEXÃO DA FONTE 5V - PASSO A PASSO VISUAL

## 🎯 SUA DÚVIDA

> "essa fonte 5v como que vou conectar no esp e no motor?"

---

## ✅ RESPOSTA SIMPLES

A fonte 5V tem **2 fios** (+ e -) que vão para o **PROTOBOARD**.
Do protoboard, você usa **JUMPERS** para distribuir para ESP32 e motores.

```
FONTE 5V
   │
   ├─ Fio VERMELHO (+5V)
   │      │
   │      └──→ PROTOBOARD Trilha VERMELHA
   │
   └─ Fio PRETO (GND)
          │
          └──→ PROTOBOARD Trilha AZUL
```

---

## 🔧 PASSO A PASSO DETALHADO

### **PASSO 1: Identificar os Fios da Fonte**

Sua fonte 5V 3A tem **2 fios**:

```
┌──────────────────────┐
│   FONTE 5V 3A        │
│   AC → DC            │
│                      │
│   [Plug AC 110-220V] │ ← Vai na tomada
│                      │
│   Saída DC:          │
│   ┌──────┐           │
│   │  +   │───────────┼─── Fio VERMELHO (+5V)
│   │  -   │───────────┼─── Fio PRETO (GND)
│   └──────┘           │
└──────────────────────┘

✅ Vermelho = +5V (positivo)
✅ Preto = GND (negativo/terra)

⚠️ Alguns fontes usam:
- Vermelho = +5V
- Preto/Branco = GND
```

**Se sua fonte tem plug P4:**
```
┌──────────────┐
│  FONTE 5V    │
│              │
│   [P4] ──────┼──→ Plug redondo
└──────────────┘
        │
        ▼
  ┌────────────┐
  │ Adaptador  │
  │ P4 → Fios  │
  └─┬────────┬─┘
    │        │
    ▼        ▼
   +5V      GND
```

---

### **PASSO 2: Preparar o Protoboard**

O protoboard tem **trilhas de alimentação** nas laterais:

```
Vista Superior do Protoboard 830 pontos:

┌─────────────────────────────────────────────────┐
│                                                 │
│  [+] ═══════════════════════════════════════   │ ← Trilha VERMELHA (+5V)
│                                                 │
│  [-] ═══════════════════════════════════════   │ ← Trilha AZUL (GND)
│                                                 │
│  ┌───────────────────────────────────────┐     │
│  │                                       │     │
│  │     ÁREA DE CONEXÕES                  │     │ ← Aqui você conecta
│  │     (linhas numeradas)                │     │    os componentes
│  │                                       │     │
│  └───────────────────────────────────────┘     │
│                                                 │
│  [+] ═══════════════════════════════════════   │ ← Trilha VERMELHA (+5V)
│                                                 │
│  [-] ═══════════════════════════════════════   │ ← Trilha AZUL (GND)
│                                                 │
└─────────────────────────────────────────────────┘

As trilhas + e - são CONTÍNUAS (toda a lateral é conectada)
```

---

### **PASSO 3: Conectar Fonte → Protoboard**

**Material necessário:**
- Fonte 5V 3A (com 2 fios)
- Protoboard
- Alicate de corte (se precisar desencapar)

**Conexão:**

```
FONTE 5V                    PROTOBOARD
┌───────────┐               ┌────────────────┐
│           │               │                │
│  (+) ─────┼───────────────┼─→ Trilha [+]   │
│  Vermelho │               │   Vermelha     │
│           │               │                │
│  (-) ─────┼───────────────┼─→ Trilha [-]   │
│  Preto    │               │   Azul         │
│           │               │                │
└───────────┘               └────────────────┘

INSTRUÇÕES:
1. Pegue o fio VERMELHO da fonte
2. Insira em QUALQUER buraco da trilha VERMELHA (+)
3. Pegue o fio PRETO da fonte
4. Insira em QUALQUER buraco da trilha AZUL (-)
```

**Visão de cima (já conectado):**

```
Protoboard com fonte conectada:

      Fio Vermelho da Fonte
             │
             ▼
┌────────────●────────────────────────────────────┐
│  [+] ═══════════════════════════════════════   │ ← +5V
│            ↑                                    │
│     Fio conectado aqui                          │
│                                                 │
│  [-] ═══════════════════════════════════════   │ ← GND
│            ↑                                    │
│     Fio Preto conectado aqui                    │
│                                                 │
│  [Área de conexões vazia ainda]                │
│                                                 │
└─────────────────────────────────────────────────┘

✅ PRONTO! Protoboard está energizado!
```

---

### **PASSO 4: Conectar ESP32 → Protoboard**

**Material necessário:**
- 2 jumpers macho-macho
  - 1 VERMELHO (para +5V)
  - 1 PRETO (para GND)

**Conexão:**

```
PROTOBOARD                     ESP32 DevKit V1
┌────────────┐                 ┌─────────────────┐
│            │                 │                 │
│ Trilha [+] ├─ Jumper ────────┤ VIN             │
│ Vermelha   │  VERMELHO       │                 │
│            │                 │                 │
│ Trilha [-] ├─ Jumper ────────┤ GND             │
│ Azul       │  PRETO          │                 │
│            │                 │                 │
└────────────┘                 └─────────────────┘

PINOS DO ESP32:
┌─────────────────┐
│  VIN  ← +5V     │ ← Pino de alimentação 5V
│  GND  ← GND     │ ← Pino terra
│  GPIO XX        │
│  ...            │
└─────────────────┘
```

**Foto de cima (já conectado):**

```
         ESP32 DevKit V1
         ┌────────────┐
         │  [USB]     │
         │            │
    ┌────┤ VIN   GND  ├────┐
    │    │            │    │
    │    └────────────┘    │
    │                      │
Jumper                  Jumper
Vermelho                Preto
    │                      │
    ▼                      ▼
┌─────────────────────────────────┐
│  [+] ═══════════════════════    │ ← Trilha +5V
│       ↑                          │
│       └── Jumper vermelho        │
│                                  │
│  [-] ═══════════════════════    │ ← Trilha GND
│       ↑                          │
│       └── Jumper preto           │
└─────────────────────────────────┘

✅ ESP32 ALIMENTADO!
```

---

### **PASSO 5: Conectar Motor (via ULN2003) → Protoboard**

**IMPORTANTE:** Motor NÃO conecta direto!
Motor conecta no **driver ULN2003** que vem junto!

**Material necessário:**
- Driver ULN2003 (vem com o motor)
- 2 jumpers macho-macho para cada motor
  - 1 VERMELHO (para +5V)
  - 1 PRETO (para GND)

**O Driver ULN2003 tem 2 conectores:**

```
Vista do Driver ULN2003:

┌────────────────────────────────┐
│                                │
│  ┌──────────────┐              │
│  │ Conector     │              │
│  │ Motor        │ ← Aqui encaixa o motor
│  │ (5 pinos)    │   (conector branco do motor)
│  └──────────────┘              │
│                                │
│  LEDs (indicadores)            │
│                                │
│  Pinos de controle:            │
│  + - IN1 IN2 IN3 IN4           │
│  │ │  │   │   │   │            │
│  ○ ○  ○   ○   ○   ○            │
└──┼─┼──┼───┼───┼───┼────────────┘
   │ │  │   │   │   │
   │ │  └───┴───┴───┴─── ESP32 GPIOs
   │ │
   │ └─── GND (Protoboard)
   └───── +5V (Protoboard)
```

**Conexão Motor 1:**

```
PROTOBOARD              ULN2003 Driver        Motor 28BYJ-48
┌──────────┐            ┌──────────────┐      ┌────────────┐
│          │            │              │      │            │
│ [+] ─────┼─ Vermelho ─┤ +            │      │  Conector  │
│          │            │              │──────┤  Branco    │
│ [-] ─────┼─ Preto ────┤ -            │      │  5 pinos   │
│          │            │              │      │            │
└──────────┘            │ IN1 ← ESP32 GPIO13  └────────────┘
                        │ IN2 ← ESP32 GPIO12
                        │ IN3 ← ESP32 GPIO14
                        │ IN4 ← ESP32 GPIO27
                        └──────────────┘

PASSOS:
1. Conecte jumper VERMELHO: Protoboard [+] → ULN2003 pino [+]
2. Conecte jumper PRETO: Protoboard [-] → ULN2003 pino [-]
3. Encaixe motor no conector do ULN2003 (5 pinos)
4. Conecte jumpers ESP32 → ULN2003 (IN1, IN2, IN3, IN4)
```

**Repita para Motor 2 e Motor 3!**

---

### **PASSO 6: Visão Geral Completa**

```
                    TOMADA 110/220V
                           │
                           ▼
                    ┌─────────────┐
                    │ FONTE 5V 3A │
                    └──┬───────┬──┘
                       │       │
                  Vermelho   Preto
                       │       │
                       ▼       ▼
        ┌──────────────────────────────────────┐
        │         PROTOBOARD                   │
        │                                      │
        │  [+] ═══════════════════════         │
        │   ↑   ↑   ↑   ↑   ↑   ↑             │
        │   │   │   │   │   │   │             │
        │   │   │   │   │   │   │             │
        │  [-] ═══════════════════════         │
        │   ↑   ↑   ↑   ↑   ↑   ↑             │
        └───┼───┼───┼───┼───┼───┼─────────────┘
            │   │   │   │   │   │
            │   │   │   │   │   │
            ▼   ▼   ▼   ▼   ▼   ▼
          ESP32 │   │   │   │   │
            ULN1│   │   │   │   │
              ULN2  │   │   │   │
                ULN3│   │   │   │
                  Sensor1 │   │
                      Sensor2 │
                          Sensor3

LEGENDA:
- ULN1, ULN2, ULN3 = Drivers dos motores
- Cada ULN tem o motor conectado
```

---

## 📊 TABELA DE CONEXÕES COMPLETA

### **Alimentação (Fonte → Protoboard):**

| De | Para | Cor do Fio |
|----|------|------------|
| Fonte (+5V) | Protoboard Trilha [+] Vermelha | Vermelho |
| Fonte (GND) | Protoboard Trilha [-] Azul | Preto |

### **ESP32:**

| De | Para | Cor do Jumper |
|----|------|---------------|
| Protoboard [+] | ESP32 VIN | Vermelho |
| Protoboard [-] | ESP32 GND | Preto |

### **Motor 1 (via ULN2003):**

| De | Para | Cor do Jumper |
|----|------|---------------|
| Protoboard [+] | ULN2003 (+) | Vermelho |
| Protoboard [-] | ULN2003 (-) | Preto |
| ESP32 GPIO13 | ULN2003 IN1 | Qualquer |
| ESP32 GPIO12 | ULN2003 IN2 | Qualquer |
| ESP32 GPIO14 | ULN2003 IN3 | Qualquer |
| ESP32 GPIO27 | ULN2003 IN4 | Qualquer |
| Motor (5 pinos) | ULN2003 Conector | Já vem |

**Repita para Motor 2 (GPIOs 26,25,33,32) e Motor 3 (GPIOs 15,2,4,5)!**

---

## 🛠️ FERRAMENTAS NECESSÁRIAS

### **Mínimo:**
- [ ] Alicate de corte (se precisar desencapar fios)
- [ ] Fita isolante (segurança)

### **Recomendado:**
- [ ] Multímetro (testar tensões)
- [ ] Alicate de bico (manipular jumpers)
- [ ] Luz de teste (verificar continuidade)

---

## ✅ CHECKLIST DE MONTAGEM

### **Antes de Ligar:**
- [ ] Fonte 5V desconectada da tomada
- [ ] Todos os fios identificados (vermelho = +, preto = -)
- [ ] Protoboard limpo e sem curtos

### **Conexão da Fonte:**
- [ ] Fio vermelho da fonte → Trilha [+] do protoboard
- [ ] Fio preto da fonte → Trilha [-] do protoboard
- [ ] Fios bem presos (não saem se puxar levemente)

### **Conexão do ESP32:**
- [ ] Jumper vermelho: Protoboard [+] → ESP32 VIN
- [ ] Jumper preto: Protoboard [-] → ESP32 GND
- [ ] ESP32 não conectado via USB ainda

### **Conexão dos Motores:**
- [ ] 3x Drivers ULN2003 com alimentação (+5V e GND)
- [ ] 3x Motores conectados nos drivers (conector branco)
- [ ] 12x jumpers ESP32 → Drivers (4 por motor)

### **Teste Inicial:**
- [ ] Multímetro na trilha [+]: deve mostrar 0V (fonte desligada)
- [ ] Conectar fonte na tomada
- [ ] Multímetro na trilha [+]: deve mostrar ~5V
- [ ] LED do ESP32 acende (se tiver LED)
- [ ] LEDs dos drivers ULN2003 podem acender

---

## 🔍 COMO TESTAR SE ESTÁ CORRETO

### **Teste 1: Tensão na Trilha**

```bash
1. Conecte fonte na tomada
2. Use multímetro:
   - Ponta vermelha na trilha [+]
   - Ponta preta na trilha [-]
3. Deve mostrar: 4.8V a 5.2V ✅

Se mostrar 0V → Fonte com problema
Se mostrar 12V → Fonte errada!
```

### **Teste 2: ESP32 Liga**

```bash
1. Com fonte ligada
2. Observe ESP32:
   - LED azul acende (se tiver) ✅
   - Não esquenta excessivamente
   - Não fuma (óbvio!)

Se não acende → Verificar conexões VIN e GND
Se esquenta → DESLIGAR IMEDIATAMENTE! Curto-circuito!
```

### **Teste 3: Motores Respondem**

```bash
1. Upload do código de teste: ESP32_28BYJ48_Exemplo.ino
2. Abra Serial Monitor
3. Digite: T (testar todos)
4. Motores devem girar! ✅

Se não giram → Verificar:
- Alimentação dos drivers (+5V e GND)
- Conexões IN1, IN2, IN3, IN4
- Motor conectado no driver
```

---

## ⚠️ CUIDADOS IMPORTANTES

### **1. POLARIDADE:**

```
✅ CORRETO:
Fonte (+) → Protoboard [+] → VIN/+5V
Fonte (-) → Protoboard [-] → GND

❌ ERRADO:
Fonte (+) → GND  } INVERTE!
Fonte (-) → VIN  } QUEIMA!
```

### **2. NUNCA MISTURE:**

```
❌ NUNCA conecte:
- USB do ESP32 + Fonte 5V SIMULTANEAMENTE
  (Escolha um ou outro!)

✅ Use:
- USB para programar (desconecte fonte)
- Fonte 5V para funcionar (desconecte USB)
```

### **3. CURTO-CIRCUITO:**

```
❌ Evite:
- Fio vermelho tocar fio preto
- Jumpers cruzados
- Componentes mal posicionados

✅ Prevenção:
- Desligue antes de mexer
- Use fita isolante
- Verifique visualmente antes de ligar
```

---

## 🎬 SEQUÊNCIA RECOMENDADA

### **Ordem de Montagem:**

```
1. Monte TUDO com fonte DESLIGADA
2. Verifique todas as conexões
3. Teste com multímetro (fonte ainda desligada)
4. Ligue a fonte na tomada
5. Meça tensão (deve ser 5V)
6. Observe se algo esquenta
7. Se OK, faça upload do código
8. Teste os motores
```

---

## 🎯 RESUMO VISUAL FINAL

```
╔══════════════════════════════════════════════════╗
║        COMO CONECTAR A FONTE 5V                  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  1. Fonte tem 2 fios:                            ║
║     • Vermelho (+5V)                             ║
║     • Preto (GND)                                ║
║                                                  ║
║  2. Conecte no Protoboard:                       ║
║     • Vermelho → Trilha [+] Vermelha             ║
║     • Preto → Trilha [-] Azul                    ║
║                                                  ║
║  3. Do Protoboard, use jumpers para:             ║
║     • ESP32 (VIN e GND)                          ║
║     • ULN2003 Driver 1 (+ e -)                   ║
║     • ULN2003 Driver 2 (+ e -)                   ║
║     • ULN2003 Driver 3 (+ e -)                   ║
║     • Sensores (VCC e GND)                       ║
║                                                  ║
║  4. Motores conectam nos drivers ULN2003         ║
║     (conector branco de 5 pinos)                 ║
║                                                  ║
║  ✅ PRONTO! Tudo alimentado por UMA fonte!       ║
║                                                  ║
╚══════════════════════════════════════════════════╝
```

---

## 📦 LISTA DE MATERIAIS (CONEXÃO)

| Item | Quantidade | Uso |
|------|-----------|-----|
| Fonte 5V 3A | 1 | Alimentação geral |
| Protoboard 830 | 1 | Distribuir energia |
| Jumpers vermelho | 7 | +5V (ESP32 + 3 drivers + 3 sensores) |
| Jumpers preto | 7 | GND (ESP32 + 3 drivers + 3 sensores) |
| Jumpers diversos | 12 | Controle motores (IN1-IN4 x3) |
| Fita isolante | 1 rolo | Segurança |

**Total de jumpers:** ~26 (kit de 40 é suficiente!)

---

## 🎉 PRONTO!

Agora você sabe **EXATAMENTE** como conectar a fonte 5V no ESP32 e nos motores!

**Lembre-se:**
- ✅ Fonte → Protoboard (2 fios)
- ✅ Protoboard → ESP32 (2 jumpers)
- ✅ Protoboard → Drivers ULN2003 (6 jumpers para 3 motores)
- ✅ Motores → Drivers (conectores brancos já vem)
- ✅ ESP32 → Drivers (12 jumpers para controle)

**Não precisa soldar NADA!**

**Qualquer dúvida, é só perguntar!** 😊
