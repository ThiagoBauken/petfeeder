/*
 * ═══════════════════════════════════════════════════════════════════
 * TESTE DO MOTOR E SENSOR - PetFeeder
 * ═══════════════════════════════════════════════════════════════════
 *
 * Use este código para testar se o hardware está funcionando
 * antes de usar o código principal.
 *
 * PINOS:
 * Motor: GPIO 16, 17, 18, 19
 * Sensor: TRIG=23, ECHO=22
 *
 * COMANDOS NO MONITOR SERIAL (115200 baud):
 * 1 = Teste pequeno (1 volta)
 * 2 = Teste médio (2 voltas)
 * 3 = Teste grande (3 voltas)
 * s = Ler sensor
 * r = Reset motor
 *
 * ═══════════════════════════════════════════════════════════════════
 */

// Pinos do Motor
#define MOTOR_IN1 16
#define MOTOR_IN2 17
#define MOTOR_IN3 18
#define MOTOR_IN4 19

// Pinos do Sensor
#define TRIG_PIN 23
#define ECHO_PIN 22

// LED
#define LED_PIN 2

// Configurações do motor
const int STEPS_PER_REVOLUTION = 2048;
const int DOSE_SMALL = 2048;   // 1 volta
const int DOSE_MEDIUM = 4096;  // 2 voltas
const int DOSE_LARGE = 6144;   // 3 voltas

// Sequência half-step
const int stepSequence[8][4] = {
  {1, 0, 0, 0},
  {1, 1, 0, 0},
  {0, 1, 0, 0},
  {0, 1, 1, 0},
  {0, 0, 1, 0},
  {0, 0, 1, 1},
  {0, 0, 0, 1},
  {1, 0, 0, 1}
};

int currentStep = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n");
  Serial.println("╔═══════════════════════════════════════════════════════════╗");
  Serial.println("║         TESTE DO MOTOR E SENSOR - PetFeeder               ║");
  Serial.println("╠═══════════════════════════════════════════════════════════╣");
  Serial.println("║ Comandos:                                                 ║");
  Serial.println("║   1 = Dose pequena (1 volta)                              ║");
  Serial.println("║   2 = Dose média (2 voltas)                               ║");
  Serial.println("║   3 = Dose grande (3 voltas)                              ║");
  Serial.println("║   s = Ler sensor ultrassônico                             ║");
  Serial.println("║   r = Parar/Reset motor                                   ║");
  Serial.println("╚═══════════════════════════════════════════════════════════╝");
  Serial.println();

  // Configura pinos do motor
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);

  // Configura pinos do sensor
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // LED
  pinMode(LED_PIN, OUTPUT);

  // Desliga motor
  stopMotor();

  Serial.println("✅ Hardware configurado! Digite um comando...\n");

  // Teste inicial do sensor
  Serial.println("📏 Teste inicial do sensor:");
  readSensor();
}

void loop() {
  if (Serial.available()) {
    char cmd = Serial.read();

    switch (cmd) {
      case '1':
        Serial.println("\n🔄 Executando DOSE PEQUENA (1 volta = 2048 passos)...");
        dispense(DOSE_SMALL);
        Serial.println("✅ Concluído!\n");
        break;

      case '2':
        Serial.println("\n🔄 Executando DOSE MÉDIA (2 voltas = 4096 passos)...");
        dispense(DOSE_MEDIUM);
        Serial.println("✅ Concluído!\n");
        break;

      case '3':
        Serial.println("\n🔄 Executando DOSE GRANDE (3 voltas = 6144 passos)...");
        dispense(DOSE_LARGE);
        Serial.println("✅ Concluído!\n");
        break;

      case 's':
      case 'S':
        Serial.println("\n📏 Lendo sensor ultrassônico...");
        readSensor();
        break;

      case 'r':
      case 'R':
        Serial.println("\n🛑 Parando motor...");
        stopMotor();
        Serial.println("✅ Motor parado!\n");
        break;

      case '\n':
      case '\r':
        // Ignora enter
        break;

      default:
        Serial.println("\n❌ Comando inválido! Use: 1, 2, 3, s, ou r\n");
        break;
    }
  }

  // Pisca LED para mostrar que está funcionando
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 1000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = millis();
  }
}

void dispense(int steps) {
  digitalWrite(LED_PIN, HIGH);

  unsigned long startTime = millis();

  for (int i = 0; i < steps; i++) {
    setStep(stepSequence[currentStep][0],
            stepSequence[currentStep][1],
            stepSequence[currentStep][2],
            stepSequence[currentStep][3]);

    currentStep = (currentStep + 1) % 8;
    delayMicroseconds(1200);  // Velocidade do motor

    // Mostra progresso a cada 10%
    if (i % (steps / 10) == 0) {
      int percent = (i * 100) / steps;
      Serial.printf("   Progresso: %d%%\n", percent);
    }
  }

  stopMotor();
  digitalWrite(LED_PIN, LOW);

  unsigned long duration = millis() - startTime;
  Serial.printf("   Tempo: %lu ms\n", duration);
}

void setStep(int a, int b, int c, int d) {
  digitalWrite(MOTOR_IN1, a);
  digitalWrite(MOTOR_IN2, b);
  digitalWrite(MOTOR_IN3, c);
  digitalWrite(MOTOR_IN4, d);
}

void stopMotor() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
}

void readSensor() {
  // Envia pulso
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Lê echo
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    Serial.println("   ⚠️ Sensor não respondeu! Verifique as conexões.");
    Serial.println("   - TRIG deve estar no GPIO 23");
    Serial.println("   - ECHO deve estar no GPIO 22");
    Serial.println("   - VCC no 5V, GND no GND\n");
    return;
  }

  float distanceCm = duration * 0.034 / 2;

  // Calcula nível de comida (assume recipiente de 5-20cm)
  float foodLevel;
  if (distanceCm < 5) {
    foodLevel = 100;
  } else if (distanceCm > 20) {
    foodLevel = 0;
  } else {
    foodLevel = map(distanceCm, 20, 5, 0, 100);
  }

  Serial.println("   ┌─────────────────────────────────┐");
  Serial.printf("   │ Distância: %.1f cm              \n", distanceCm);
  Serial.printf("   │ Nível de comida: %.0f%%          \n", foodLevel);
  Serial.println("   └─────────────────────────────────┘");

  if (foodLevel < 20) {
    Serial.println("   ⚠️ ALERTA: Nível de comida baixo!\n");
  } else {
    Serial.println();
  }
}
