# 🔧 GUIA COMPLETO - Motor 28BYJ-48 + ULN2003

## 📋 VISÃO GERAL

O motor **28BYJ-48** com driver **ULN2003** é perfeito para o PetFeeder! Ele já está **totalmente implementado** no firmware.

**Características:**
- ✅ Precisão: 4096 passos por revolução
- ✅ Torque: ~34.3 mN.m (suficiente para ração)
- ✅ Tensão: 5V DC
- ✅ Baixo ruído
- ✅ Baixo custo (~R$15-25)

---

## 🛒 HARDWARE NECESSÁRIO

### Por Compartimento (3x para 3 pets):

| Item | Quantidade | Preço Un. | Total |
|------|------------|-----------|-------|
| Motor 28BYJ-48 | 1 | R$ 12 | R$ 12 |
| Driver ULN2003 | 1 | R$ 8 | R$ 8 |
| Jumpers | 4 | R$ 0,50 | R$ 2 |
| **Subtotal** | - | - | **R$ 22** |

### Para 3 Compartimentos (Setup Completo):

| Item | Quantidade | Preço Total |
|------|------------|-------------|
| Motores 28BYJ-48 | 3 | R$ 36 |
| Drivers ULN2003 | 3 | R$ 24 |
| ESP32 DevKit | 1 | R$ 45 |
| Fonte 5V 3A | 1 | R$ 25 |
| Sensor HC-SR04 (opcional) | 3 | R$ 30 |
| RTC DS3231 (opcional) | 1 | R$ 15 |
| **TOTAL** | - | **R$ 175** |

---

## 📐 PINOUT DO MOTOR 28BYJ-48

### Cabo do Motor (5 fios):

```
Motor 28BYJ-48
┌─────────────┐
│   [Motor]   │
└──┬──┬──┬──┬─┘
   │  │  │  │
   1  2  3  4  5
   │  │  │  │  │
  Red│  │  │  │
   Orange │  │
      Yellow │
         Pink
           Blue

Conexão correta:
- Red    → +5V (comum)
- Orange → IN1
- Yellow → IN2
- Pink   → IN3
- Blue   → IN4
```

### Driver ULN2003:

```
┌─────────────────────────┐
│      ULN2003 Board      │
│                         │
│  IN1  IN2  IN3  IN4     │
│   │    │    │    │      │
│  GND  VCC               │
└───┴────┴────┴────┴──────┘
    │    │    │    │
   ESP32 GPIOs
```

---

## 🔌 DIAGRAMA DE CONEXÃO - 3 MOTORES

### Motor 1 (Compartimento 1):

```
ESP32          ULN2003        Motor 28BYJ-48
GPIO 13  ───►  IN1     ───►   Orange
GPIO 12  ───►  IN2     ───►   Yellow
GPIO 14  ───►  IN3     ───►   Pink
GPIO 27  ───►  IN4     ───►   Blue

5V       ───►  VCC
GND      ───►  GND
                +5V    ───►   Red (motor)
```

### Motor 2 (Compartimento 2):

```
ESP32          ULN2003        Motor 28BYJ-48
GPIO 26  ───►  IN1     ───►   Orange
GPIO 25  ───►  IN2     ───►   Yellow
GPIO 33  ───►  IN3     ───►   Pink
GPIO 32  ───►  IN4     ───►   Blue

5V       ───►  VCC
GND      ───►  GND
                +5V    ───►   Red (motor)
```

### Motor 3 (Compartimento 3):

```
ESP32          ULN2003        Motor 28BYJ-48
GPIO 15  ───►  IN1     ───►   Orange
GPIO 2   ───►  IN2     ───►   Yellow
GPIO 4   ───►  IN3     ───►   Pink
GPIO 5   ───►  IN4     ───►   Blue

5V       ───►  VCC
GND      ───►  GND
                +5V    ───►   Red (motor)
```

### Diagrama Completo:

```
                        ┌─────────────┐
                        │   ESP32     │
                        │   DevKit    │
                        │             │
        ┌───────────────┤ 13,12,14,27 ├───────────┐
        │               │             │           │
        │       ┌───────┤ 26,25,33,32 ├───────┐   │
        │       │       │             │       │   │
        │       │   ┌───┤ 15,2,4,5    ├───┐   │   │
        │       │   │   │             │   │   │   │
        │       │   │   │  5V   GND   │   │   │   │
        │       │   │   └──┬─────┬────┘   │   │   │
        ▼       ▼   ▼      │     │        │   │   │
    ┌──────┐┌──────┐┌──────┐    │        │   │   │
    │ULN03 ││ULN03 ││ULN03 │◄───┴────────┴───┴───┘
    │ #1   ││ #2   ││ #3   │
    └──┬───┘└──┬───┘└──┬───┘
       │       │       │
       ▼       ▼       ▼
   [Motor1][Motor2][Motor3]
      🐱      🐱      🐱
```

---

## 💻 CÓDIGO DO FIRMWARE

### Versão Recomendada: `ESP32_SaaS_Client.ino` ou `PetFeeder_ESP32_Final.ino`

Ambos já suportam o motor 28BYJ-48!

### Configuração no Código:

```cpp
// ============================================
// CONFIGURAÇÃO DOS MOTORES 28BYJ-48
// ============================================

// Motor 1 (Compartimento 1)
const int MOTOR1_IN1 = 13;
const int MOTOR1_IN2 = 12;
const int MOTOR1_IN3 = 14;
const int MOTOR1_IN4 = 27;

// Motor 2 (Compartimento 2)
const int MOTOR2_IN1 = 26;
const int MOTOR2_IN2 = 25;
const int MOTOR2_IN3 = 33;
const int MOTOR2_IN4 = 32;

// Motor 3 (Compartimento 3)
const int MOTOR3_IN1 = 15;
const int MOTOR3_IN2 = 2;
const int MOTOR3_IN3 = 4;
const int MOTOR3_IN4 = 5;

// Sequência Half-Step (8 passos por ciclo)
const int stepsPerRevolution = 4096;  // 28BYJ-48 com half-stepping
const int halfStepSequence[8][4] = {
  {1, 0, 0, 0},  // Passo 1
  {1, 1, 0, 0},  // Passo 2
  {0, 1, 0, 0},  // Passo 3
  {0, 1, 1, 0},  // Passo 4
  {0, 0, 1, 0},  // Passo 5
  {0, 0, 1, 1},  // Passo 6
  {0, 0, 0, 1},  // Passo 7
  {1, 0, 0, 1}   // Passo 8
};
```

### Função de Controle:

```cpp
void rotateMotor(int motorNum, int steps, int delayTime = 2) {
  int pins[4];

  // Selecionar pinos do motor
  switch(motorNum) {
    case 1:
      pins[0] = MOTOR1_IN1; pins[1] = MOTOR1_IN2;
      pins[2] = MOTOR1_IN3; pins[3] = MOTOR1_IN4;
      break;
    case 2:
      pins[0] = MOTOR2_IN1; pins[1] = MOTOR2_IN2;
      pins[2] = MOTOR2_IN3; pins[3] = MOTOR2_IN4;
      break;
    case 3:
      pins[0] = MOTOR3_IN1; pins[1] = MOTOR3_IN2;
      pins[2] = MOTOR3_IN3; pins[3] = MOTOR3_IN4;
      break;
    default:
      return;
  }

  // Executar passos
  for (int i = 0; i < steps; i++) {
    int stepIndex = i % 8;

    digitalWrite(pins[0], halfStepSequence[stepIndex][0]);
    digitalWrite(pins[1], halfStepSequence[stepIndex][1]);
    digitalWrite(pins[2], halfStepSequence[stepIndex][2]);
    digitalWrite(pins[3], halfStepSequence[stepIndex][3]);

    delay(delayTime);
  }

  // Desligar motor (economizar energia)
  digitalWrite(pins[0], LOW);
  digitalWrite(pins[1], LOW);
  digitalWrite(pins[2], LOW);
  digitalWrite(pins[3], LOW);
}
```

### Alimentar com Quantidade em Gramas:

```cpp
// Calibração: quantos passos = 1 grama
// Ajuste conforme seu mecanismo!
const int STEPS_PER_GRAM = 50;  // Valor inicial, calibre!

void feedPet(int compartment, int grams) {
  Serial.printf("Alimentando compartimento %d com %dg\n", compartment, grams);

  int totalSteps = grams * STEPS_PER_GRAM;

  rotateMotor(compartment, totalSteps, 2);

  Serial.printf("Dispensado: %dg (_%d passos)\n", grams, totalSteps);
}
```

---

## 🎛️ CALIBRAÇÃO DO MOTOR

### Passo 1: Teste Básico

```cpp
void setup() {
  Serial.begin(115200);

  // Configurar pinos
  pinMode(MOTOR1_IN1, OUTPUT);
  pinMode(MOTOR1_IN2, OUTPUT);
  pinMode(MOTOR1_IN3, OUTPUT);
  pinMode(MOTOR1_IN4, OUTPUT);

  Serial.println("Teste: 1 rotação completa");
  rotateMotor(1, 4096, 2);  // 1 rotação = 4096 passos

  delay(2000);

  Serial.println("Teste: Meia rotação");
  rotateMotor(1, 2048, 2);  // Meia rotação
}
```

### Passo 2: Calibrar Gramas

1. **Prepare o mecanismo**:
   - Monte o motor no dispensador
   - Coloque ração no compartimento
   - Posicione um recipiente embaixo

2. **Rode o teste**:

```cpp
void calibrateGrams() {
  Serial.println("=== CALIBRAÇÃO ===");
  Serial.println("Teste 1: 500 passos");

  rotateMotor(1, 500, 2);
  delay(3000);

  // Pese a ração dispensada!
  Serial.println("Pese a ração e digite o valor em gramas no Serial Monitor");

  // Aguardar input do Serial Monitor
  while (!Serial.available()) {
    delay(100);
  }

  float gramsDispensed = Serial.parseFloat();

  // Calcular passos por grama
  int stepsPerGram = 500 / gramsDispensed;

  Serial.printf("Resultado: %d passos = 1 grama\n", stepsPerGram);
  Serial.printf("Atualize STEPS_PER_GRAM = %d no código\n", stepsPerGram);
}
```

3. **Ajustar o valor**:
   - Se 500 passos = 10g → `STEPS_PER_GRAM = 50`
   - Se 500 passos = 5g → `STEPS_PER_GRAM = 100`
   - Se 500 passos = 20g → `STEPS_PER_GRAM = 25`

### Passo 3: Testar Diferentes Velocidades

```cpp
void testSpeeds() {
  Serial.println("Teste velocidade 1ms");
  rotateMotor(1, 2048, 1);  // Rápido
  delay(2000);

  Serial.println("Teste velocidade 2ms");
  rotateMotor(1, 2048, 2);  // Médio (recomendado)
  delay(2000);

  Serial.println("Teste velocidade 5ms");
  rotateMotor(1, 2048, 5);  // Lento (mais torque)
  delay(2000);
}
```

**Recomendação:**
- **2ms**: Bom equilíbrio velocidade/torque
- **1ms**: Mais rápido, pode perder passos
- **5ms**: Mais lento, mais preciso

---

## 🔧 MECANISMO DISPENSADOR

### Opção 1: Rosca Sem Fim (Recomendado)

```
┌──────────────────────────┐
│   Compartimento Ração    │
│   ┌──────────────────┐   │
│   │  ╔════════════╗  │   │
│   │  ║  Ração     ║  │   │
│   │  ║            ║  │   │
│   │  ╚═════╗══════╝  │   │
│   └────────║─────────┘   │
│            ║             │
│       ┌────▼────┐        │
│       │ ╔═══╗   │ ◄── Motor gira rosca
│       │ ║   ║   │        │
│       │ ╚═══╝   │        │
│       └────┬────┘        │
│            │             │
│            ▼             │
│       ┌────────┐         │
│       │  Saída │         │
│       └────────┘         │
└──────────────────────────┘

Vantagens:
✓ Dosagem precisa
✓ Não entope
✓ Controle fino
```

### Opção 2: Comporta Basculante

```
┌──────────────────────────┐
│   Compartimento Ração    │
│                          │
│       ╔════════╗         │
│       ║ Ração  ║         │
│       ╚═══╗════╝         │
│           ║              │
│      ┌────▼────┐         │
│      │ ┌─────┐ │ ◄── Motor gira
│      │ │  ╱  │ │     comporta
│      │ └─────┘ │         │
│      └────┬────┘         │
│           │              │
│           ▼              │
│      ┌────────┐          │
│      │  Saída │          │
│      └────────┘          │
└──────────────────────────┘

Vantagens:
✓ Simples de construir
✓ Fácil manutenção
✓ Boa para ração seca
```

### Opção 3: Tambor Rotativo

```
          Motor
            │
            ▼
       ┌────────┐
       │ ┏━━━━┓ │
       │ ┃    ┃ │ ◄── Tambor com
       │ ┃ O  ┃ │     compartimento
       │ ┗━━━━┛ │
       └────┬───┘
            │
      Ração cai ▼

Vantagens:
✓ Simples
✓ Confiável
✓ Fácil calibração
```

---

## 📏 MONTAGEM FÍSICA

### Lista de Materiais Adicionais:

| Item | Onde Comprar | Preço |
|------|--------------|-------|
| Tubo PVC 50mm (1m) | Casa de construção | R$ 15 |
| Conexões T PVC | Casa de construção | R$ 10 |
| Parafusos M3 | Casa de construção | R$ 5 |
| MDF 6mm (30x30cm) | Madeireira | R$ 10 |
| Cola quente | Papelaria | R$ 8 |
| Recipientes 1L | Supermercado | R$ 30 |

### Passo a Passo:

1. **Base do Motor**
   - Cortar MDF 10x10cm
   - Furos para parafusos do motor
   - Fixar motor com parafusos M3

2. **Acoplamento Motor-Rosca**
   - Imprimir em 3D ou usar tubo plástico
   - Encaixe no eixo do motor
   - Fixar com cola quente

3. **Tubo Dispensador**
   - Cortar tubo PVC 15cm
   - Rosca interna (opcional)
   - Conectar à saída do compartimento

4. **Funil de Saída**
   - Garrafa PET cortada
   - Ou imprimir em 3D
   - Direcionar para o pote

---

## 🧪 TESTES E TROUBLESHOOTING

### Problema 1: Motor não gira

**Verificar:**
1. Conexões dos pinos
2. Alimentação 5V
3. Sequência de passos correta
4. Serial Monitor mostra erros?

**Teste:**
```cpp
// Teste manual de cada pino
digitalWrite(MOTOR1_IN1, HIGH); delay(1000); digitalWrite(MOTOR1_IN1, LOW);
digitalWrite(MOTOR1_IN2, HIGH); delay(1000); digitalWrite(MOTOR1_IN2, LOW);
digitalWrite(MOTOR1_IN3, HIGH); delay(1000); digitalWrite(MOTOR1_IN3, LOW);
digitalWrite(MOTOR1_IN4, HIGH); delay(1000); digitalWrite(MOTOR1_IN4, LOW);
```

### Problema 2: Motor gira mas perde passos

**Soluções:**
- Aumentar delay: `rotateMotor(1, steps, 3)` em vez de 2
- Verificar fonte de alimentação (mínimo 1A)
- Reduzir carga mecânica
- Lubrificar mecanismo

### Problema 3: Motor superaquece

**Soluções:**
- Desligar bobinas após movimento:
  ```cpp
  digitalWrite(pins[0], LOW);
  digitalWrite(pins[1], LOW);
  digitalWrite(pins[2], LOW);
  digitalWrite(pins[3], LOW);
  ```
- Adicionar ventilação
- Verificar curto-circuito

### Problema 4: Dosagem imprecisa

**Soluções:**
- Recalibrar `STEPS_PER_GRAM`
- Verificar ração não está entupindo
- Ajustar velocidade (delay)
- Testar com diferentes tipos de ração

---

## 📊 ESPECIFICAÇÕES TÉCNICAS 28BYJ-48

```
Motor: 28BYJ-48
Driver: ULN2003

Tensão: 5V DC
Corrente: ~240mA (bobina ativa)
Resistência: ~50Ω por bobina
Torque: 34.3 mN.m (máximo)

Passos:
- Full-step: 2048 passos/revolução
- Half-step: 4096 passos/revolução

Redução: 1:64
Velocidade: ~15 RPM (máx)
Ângulo por passo: 5.625° / 64

Peso: ~30g
Dimensões: 28mm diâmetro x 20mm altura
```

---

## 💡 DICAS PROFISSIONAIS

### 1. Economia de Energia
```cpp
// Desligar motor quando parado
void stopMotor(int motorNum) {
  int pins[4];
  // ... selecionar pinos ...

  digitalWrite(pins[0], LOW);
  digitalWrite(pins[1], LOW);
  digitalWrite(pins[2], LOW);
  digitalWrite(pins[3], LOW);
}
```

### 2. Direção Reversa
```cpp
// Para desobstruir
void rotateReverse(int motorNum, int steps) {
  // Inverter sequência
  for (int i = steps; i >= 0; i--) {
    // ... sequência invertida ...
  }
}
```

### 3. Aceleração Suave
```cpp
void rotateSmooth(int motorNum, int steps) {
  int delayTime = 10;  // Começar lento

  for (int i = 0; i < steps; i++) {
    // ... executar passo ...

    // Acelerar gradualmente
    if (delayTime > 2) delayTime--;

    delay(delayTime);
  }
}
```

---

## ✅ CHECKLIST FINAL

- [ ] Motor 28BYJ-48 comprado
- [ ] Driver ULN2003 comprado
- [ ] Conexões verificadas com multímetro
- [ ] Firmware atualizado
- [ ] Pinos configurados corretamente
- [ ] Fonte 5V 3A instalada
- [ ] Teste básico executado (1 rotação)
- [ ] Calibração realizada
- [ ] Mecanismo dispensador montado
- [ ] Teste com ração real
- [ ] Dosagem precisa confirmada
- [ ] Integrado com backend
- [ ] Teste via dashboard web

---

## 🎉 PRONTO!

Seu PetFeeder com motor **28BYJ-48** está configurado!

**Próximo passo:** Integrar com o backend seguindo o guia [INTEGRACAO_COMPLETA.md](INTEGRACAO_COMPLETA.md)

**Calibração recomendada:**
- Iniciar com `STEPS_PER_GRAM = 50`
- Ajustar após testes práticos
- Testar com diferentes tipos de ração

**Boa sorte!** 🚀🐾
