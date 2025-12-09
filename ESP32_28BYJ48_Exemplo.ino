/*
 * ========================================
 * PETFEEDER - EXEMPLO MOTOR 28BYJ-48
 * ========================================
 *
 * Código de exemplo para testar 3 motores
 * 28BYJ-48 com driver ULN2003
 *
 * Autor: PetFeeder Team
 * Data: 2024
 * Versão: 1.0
 */

// ========================================
// CONFIGURAÇÃO DOS PINOS - 3 MOTORES
// ========================================

// Motor 1 (Compartimento 1 - Pet 1)
const int MOTOR1_IN1 = 13;
const int MOTOR1_IN2 = 12;
const int MOTOR1_IN3 = 14;
const int MOTOR1_IN4 = 27;

// Motor 2 (Compartimento 2 - Pet 2)
const int MOTOR2_IN1 = 26;
const int MOTOR2_IN2 = 25;
const int MOTOR2_IN3 = 33;
const int MOTOR2_IN4 = 32;

// Motor 3 (Compartimento 3 - Pet 3)
const int MOTOR3_IN1 = 15;
const int MOTOR3_IN2 = 2;
const int MOTOR3_IN3 = 4;
const int MOTOR3_IN4 = 5;

// ========================================
// CONFIGURAÇÃO DO MOTOR 28BYJ-48
// ========================================

// Passos por revolução (half-stepping)
const int STEPS_PER_REVOLUTION = 4096;

// Calibração: quantos passos = 1 grama
// AJUSTE ESTE VALOR após calibrar com ração real!
int STEPS_PER_GRAM = 50;  // Valor inicial

// Velocidade (delay entre passos em ms)
int MOTOR_SPEED = 2;  // 2ms = velocidade média

// ========================================
// SEQUÊNCIA HALF-STEP (8 passos)
// ========================================

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

// ========================================
// SETUP
// ========================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("   PETFEEDER - TESTE MOTOR 28BYJ-48");
  Serial.println("========================================\n");

  // Configurar todos os pinos como OUTPUT
  setupMotorPins();

  Serial.println("Motores configurados!");
  Serial.println("Digite no Serial Monitor:");
  Serial.println("  1 = Testar Motor 1");
  Serial.println("  2 = Testar Motor 2");
  Serial.println("  3 = Testar Motor 3");
  Serial.println("  A = Alimentar Pet 1 (50g)");
  Serial.println("  B = Alimentar Pet 2 (50g)");
  Serial.println("  C = Alimentar Pet 3 (50g)");
  Serial.println("  T = Testar todos os motores");
  Serial.println("  S = Calibração (500 passos)");
  Serial.println("  R = Rotação completa Motor 1");
  Serial.println("\n========================================\n");
}

// ========================================
// LOOP PRINCIPAL
// ========================================

void loop() {
  if (Serial.available()) {
    char command = Serial.read();

    switch(command) {
      case '1':
        testMotor(1);
        break;

      case '2':
        testMotor(2);
        break;

      case '3':
        testMotor(3);
        break;

      case 'A':
      case 'a':
        feedPet(1, 50);
        break;

      case 'B':
      case 'b':
        feedPet(2, 50);
        break;

      case 'C':
      case 'c':
        feedPet(3, 50);
        break;

      case 'T':
      case 't':
        testAllMotors();
        break;

      case 'S':
      case 's':
        calibrate();
        break;

      case 'R':
      case 'r':
        fullRotation(1);
        break;

      default:
        Serial.println("Comando inválido!");
        break;
    }
  }
}

// ========================================
// FUNÇÕES DE CONTROLE DO MOTOR
// ========================================

void setupMotorPins() {
  // Motor 1
  pinMode(MOTOR1_IN1, OUTPUT);
  pinMode(MOTOR1_IN2, OUTPUT);
  pinMode(MOTOR1_IN3, OUTPUT);
  pinMode(MOTOR1_IN4, OUTPUT);

  // Motor 2
  pinMode(MOTOR2_IN1, OUTPUT);
  pinMode(MOTOR2_IN2, OUTPUT);
  pinMode(MOTOR2_IN3, OUTPUT);
  pinMode(MOTOR2_IN4, OUTPUT);

  // Motor 3
  pinMode(MOTOR3_IN1, OUTPUT);
  pinMode(MOTOR3_IN2, OUTPUT);
  pinMode(MOTOR3_IN3, OUTPUT);
  pinMode(MOTOR3_IN4, OUTPUT);

  // Desligar todos os motores
  stopAllMotors();
}

void rotateMotor(int motorNum, int steps, int delayTime) {
  int pins[4];

  // Selecionar pinos do motor
  switch(motorNum) {
    case 1:
      pins[0] = MOTOR1_IN1;
      pins[1] = MOTOR1_IN2;
      pins[2] = MOTOR1_IN3;
      pins[3] = MOTOR1_IN4;
      break;

    case 2:
      pins[0] = MOTOR2_IN1;
      pins[1] = MOTOR2_IN2;
      pins[2] = MOTOR2_IN3;
      pins[3] = MOTOR2_IN4;
      break;

    case 3:
      pins[0] = MOTOR3_IN1;
      pins[1] = MOTOR3_IN2;
      pins[2] = MOTOR3_IN3;
      pins[3] = MOTOR3_IN4;
      break;

    default:
      Serial.println("Motor inválido!");
      return;
  }

  // Executar passos
  for (int i = 0; i < steps; i++) {
    int stepIndex = i % 8;

    digitalWrite(pins[0], halfStepSequence[stepIndex][0]);
    digitalWrite(pins[1], halfStepSequence[stepIndex][1]);
    digitalWrite(pins[2], halfStepSequence[stepIndex][2]);
    digitalWrite(pins[3], halfStepSequence[stepIndex][3]);

    delayMicroseconds(delayTime * 1000);
  }

  // Desligar motor (economizar energia)
  stopMotor(motorNum);
}

void stopMotor(int motorNum) {
  int pins[4];

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

  digitalWrite(pins[0], LOW);
  digitalWrite(pins[1], LOW);
  digitalWrite(pins[2], LOW);
  digitalWrite(pins[3], LOW);
}

void stopAllMotors() {
  stopMotor(1);
  stopMotor(2);
  stopMotor(3);
}

// ========================================
// FUNÇÕES DE TESTE
// ========================================

void testMotor(int motorNum) {
  Serial.printf("\n--- Testando Motor %d ---\n", motorNum);
  Serial.println("Meia rotação horária...");

  rotateMotor(motorNum, STEPS_PER_REVOLUTION / 2, MOTOR_SPEED);

  Serial.println("Concluído!");
  Serial.println("==========================\n");
}

void testAllMotors() {
  Serial.println("\n========================================");
  Serial.println("   TESTE SEQUENCIAL DE TODOS OS MOTORES");
  Serial.println("========================================\n");

  for (int i = 1; i <= 3; i++) {
    Serial.printf("Motor %d: 1/4 rotação...\n", i);
    rotateMotor(i, STEPS_PER_REVOLUTION / 4, MOTOR_SPEED);
    delay(1000);
  }

  Serial.println("\nTodos os motores testados!");
  Serial.println("========================================\n");
}

void fullRotation(int motorNum) {
  Serial.printf("\n--- Rotação Completa Motor %d ---\n", motorNum);
  Serial.printf("Executando %d passos...\n", STEPS_PER_REVOLUTION);

  unsigned long startTime = millis();

  rotateMotor(motorNum, STEPS_PER_REVOLUTION, MOTOR_SPEED);

  unsigned long duration = millis() - startTime;

  Serial.printf("Concluído em %lu ms\n", duration);
  Serial.println("==================================\n");
}

// ========================================
// CALIBRAÇÃO
// ========================================

void calibrate() {
  Serial.println("\n========================================");
  Serial.println("         MODO CALIBRAÇÃO");
  Serial.println("========================================\n");

  Serial.println("1. Posicione um recipiente embaixo do Motor 1");
  Serial.println("2. Certifique-se que tem ração no compartimento");
  Serial.println("3. O motor vai girar 500 passos");
  Serial.println("4. Pese a ração dispensada");
  Serial.println("\nPressione qualquer tecla para começar...");

  // Aguardar input
  while (!Serial.available()) {
    delay(100);
  }
  while (Serial.available()) Serial.read(); // Limpar buffer

  Serial.println("\nIniciando teste...");
  delay(1000);

  // Executar 500 passos
  rotateMotor(1, 500, MOTOR_SPEED);

  Serial.println("\nTeste concluído!");
  Serial.println("Pese a ração dispensada e calcule:");
  Serial.println("STEPS_PER_GRAM = 500 / gramas_pesadas");
  Serial.println("\nExemplo:");
  Serial.println("  Se pesou 10g → STEPS_PER_GRAM = 50");
  Serial.println("  Se pesou 5g  → STEPS_PER_GRAM = 100");
  Serial.println("  Se pesou 25g → STEPS_PER_GRAM = 20");
  Serial.println("\nAtualize o valor no início do código!");
  Serial.println("========================================\n");
}

// ========================================
// ALIMENTAÇÃO
// ========================================

void feedPet(int compartment, int grams) {
  Serial.println("\n========================================");
  Serial.printf("   ALIMENTANDO PET %d - %dg\n", compartment, grams);
  Serial.println("========================================\n");

  int totalSteps = grams * STEPS_PER_GRAM;

  Serial.printf("Passos a executar: %d\n", totalSteps);
  Serial.printf("Velocidade: %dms por passo\n", MOTOR_SPEED);
  Serial.println("Iniciando...\n");

  unsigned long startTime = millis();

  rotateMotor(compartment, totalSteps, MOTOR_SPEED);

  unsigned long duration = millis() - startTime;

  Serial.printf("\nConcluído em %lu ms\n", duration);
  Serial.printf("Dispensado: %dg\n", grams);
  Serial.println("========================================\n");
}

// ========================================
// FUNÇÃO EXTRA: ALIMENTAÇÃO COM ACELERAÇÃO
// ========================================

void feedPetSmooth(int compartment, int grams) {
  Serial.printf("Alimentando Pet %d (modo suave): %dg\n", compartment, grams);

  int totalSteps = grams * STEPS_PER_GRAM;
  int pins[4];

  // Selecionar pinos
  switch(compartment) {
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

  int delayTime = 10;  // Começar lento

  for (int i = 0; i < totalSteps; i++) {
    int stepIndex = i % 8;

    digitalWrite(pins[0], halfStepSequence[stepIndex][0]);
    digitalWrite(pins[1], halfStepSequence[stepIndex][1]);
    digitalWrite(pins[2], halfStepSequence[stepIndex][2]);
    digitalWrite(pins[3], halfStepSequence[stepIndex][3]);

    // Acelerar gradualmente até velocidade normal
    if (i < 100 && delayTime > MOTOR_SPEED) {
      delayTime--;
    }

    // Desacelerar no final
    if (i > totalSteps - 100 && delayTime < 10) {
      delayTime++;
    }

    delayMicroseconds(delayTime * 1000);
  }

  stopMotor(compartment);
  Serial.println("Alimentação concluída!");
}

// ========================================
// FUNÇÃO EXTRA: ROTAÇÃO REVERSA
// ========================================

void rotateReverse(int motorNum, int steps, int delayTime) {
  Serial.printf("Rotação reversa Motor %d: %d passos\n", motorNum, steps);

  int pins[4];

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

  // Executar sequência invertida
  for (int i = steps; i >= 0; i--) {
    int stepIndex = i % 8;

    digitalWrite(pins[0], halfStepSequence[stepIndex][0]);
    digitalWrite(pins[1], halfStepSequence[stepIndex][1]);
    digitalWrite(pins[2], halfStepSequence[stepIndex][2]);
    digitalWrite(pins[3], halfStepSequence[stepIndex][3]);

    delayMicroseconds(delayTime * 1000);
  }

  stopMotor(motorNum);
  Serial.println("Rotação reversa concluída!");
}

/*
 * ========================================
 * NOTAS DE USO:
 * ========================================
 *
 * 1. CALIBRAÇÃO:
 *    - Execute o comando 'S'
 *    - Pese a ração dispensada
 *    - Calcule STEPS_PER_GRAM
 *    - Atualize o valor no início do código
 *
 * 2. VELOCIDADE:
 *    - MOTOR_SPEED = 1ms (rápido, pode perder passos)
 *    - MOTOR_SPEED = 2ms (recomendado)
 *    - MOTOR_SPEED = 5ms (lento, mais torque)
 *
 * 3. ALIMENTAÇÃO 5V:
 *    - Use fonte de 5V 3A (mínimo 1A por motor)
 *    - NÃO alimente 3 motores simultaneamente!
 *    - Alimente sequencialmente
 *
 * 4. CONEXÕES:
 *    - Verifique com multímetro
 *    - Cores: Laranja=IN1, Amarelo=IN2, Rosa=IN3, Azul=IN4
 *    - Vermelho=+5V (comum)
 *
 * 5. INTEGRAÇÃO COM BACKEND:
 *    - Substitua as funções feedPet() pelo código MQTT
 *    - Veja ESP32_SaaS_Client.ino para exemplo completo
 *
 * ========================================
 */
