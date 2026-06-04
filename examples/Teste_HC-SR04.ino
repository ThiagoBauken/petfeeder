/*
 * ========================================
 * TESTE SENSOR HC-SR04 - PetFeeder
 * ========================================
 *
 * Testa 3 sensores ultrassônicos HC-SR04
 * Mostra nível de ração em cada compartimento
 *
 * Autor: PetFeeder Team
 * Data: 2024
 * Versão: 1.0
 */

// ========================================
// CONFIGURAÇÃO DOS PINOS - 3 SENSORES
// ========================================

// Sensor 1 (Compartimento 1)
const int SENSOR1_TRIG = 19;
const int SENSOR1_ECHO = 18;

// Sensor 2 (Compartimento 2)
const int SENSOR2_TRIG = 23;
const int SENSOR2_ECHO = 22;

// Sensor 3 (Compartimento 3)
const int SENSOR3_TRIG = 16;
const int SENSOR3_ECHO = 17;

// Arrays para facilitar loop
const int trigPins[] = {SENSOR1_TRIG, SENSOR2_TRIG, SENSOR3_TRIG};
const int echoPins[] = {SENSOR1_ECHO, SENSOR2_ECHO, SENSOR3_ECHO};

// ========================================
// CONFIGURAÇÃO DO COMPARTIMENTO
// ========================================

// Altura do compartimento (em cm)
// AJUSTE ESTE VALOR conforme seu recipiente!
const float COMPARTMENT_HEIGHT = 20.0;  // 20cm de altura

// Distância mínima válida (cm)
const float MIN_DISTANCE = 2.0;

// Distância máxima válida (cm)
const float MAX_DISTANCE = 400.0;

// ========================================
// VARIÁVEIS GLOBAIS
// ========================================

float lastDistances[3] = {0, 0, 0};
int lastPercentages[3] = {0, 0, 0};

// ========================================
// SETUP
// ========================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("   PETFEEDER - TESTE HC-SR04");
  Serial.println("========================================\n");

  // Configurar pinos dos sensores
  for (int i = 0; i < 3; i++) {
    pinMode(trigPins[i], OUTPUT);
    pinMode(echoPins[i], INPUT);
    digitalWrite(trigPins[i], LOW);
  }

  delay(100);

  Serial.println("✅ Sensores configurados!");
  Serial.printf("📏 Altura do compartimento: %.1f cm\n\n", COMPARTMENT_HEIGHT);

  Serial.println("Digite no Serial Monitor:");
  Serial.println("  T = Teste rápido");
  Serial.println("  C = Teste contínuo");
  Serial.println("  M = Teste com média de leituras");
  Serial.println("  1 = Testar apenas Sensor 1");
  Serial.println("  2 = Testar apenas Sensor 2");
  Serial.println("  3 = Testar apenas Sensor 3");
  Serial.println("  A = Ajustar altura do compartimento");
  Serial.println("\n========================================\n");
}

// ========================================
// LOOP PRINCIPAL
// ========================================

void loop() {
  if (Serial.available()) {
    char command = Serial.read();

    switch(command) {
      case 'T':
      case 't':
        testAllSensorsOnce();
        break;

      case 'C':
      case 'c':
        testContinuous();
        break;

      case 'M':
      case 'm':
        testWithAverage();
        break;

      case '1':
        testSingleSensor(0);
        break;

      case '2':
        testSingleSensor(1);
        break;

      case '3':
        testSingleSensor(2);
        break;

      case 'A':
      case 'a':
        adjustHeight();
        break;

      default:
        Serial.println("Comando inválido!");
        break;
    }
  }

  delay(10);
}

// ========================================
// FUNÇÕES DE TESTE
// ========================================

void testAllSensorsOnce() {
  Serial.println("\n─────────────────────────────────────");
  Serial.println("📊 LEITURA DOS 3 COMPARTIMENTOS");
  Serial.println("─────────────────────────────────────\n");

  for (int i = 0; i < 3; i++) {
    float distance = readDistance(i);

    if (distance < 0) {
      Serial.printf("  Compartimento %d: ❌ ERRO DE LEITURA\n\n", i + 1);
      continue;
    }

    displayReading(i, distance);
  }

  Serial.println("─────────────────────────────────────\n");
}

void testContinuous() {
  Serial.println("\n🔄 MODO CONTÍNUO (pressione qualquer tecla para parar)\n");

  while (!Serial.available()) {
    Serial.print("\033[H\033[J");  // Limpar tela (ANSI)

    Serial.println("========================================");
    Serial.println("   MONITORAMENTO CONTÍNUO");
    Serial.println("========================================\n");

    for (int i = 0; i < 3; i++) {
      float distance = readDistance(i);

      if (distance < 0) {
        Serial.printf("Compartimento %d: ❌ ERRO\n\n", i + 1);
        continue;
      }

      displayReading(i, distance);
    }

    Serial.println("========================================");
    Serial.println("Pressione qualquer tecla para parar...\n");

    delay(1000);
  }

  while (Serial.available()) Serial.read();  // Limpar buffer
  Serial.println("\n✅ Modo contínuo encerrado.\n");
}

void testWithAverage() {
  Serial.println("\n📊 TESTE COM MÉDIA DE 5 LEITURAS\n");

  for (int i = 0; i < 3; i++) {
    Serial.printf("Compartimento %d: ", i + 1);

    float distance = readDistanceAverage(i, 5);

    if (distance < 0) {
      Serial.println("❌ ERRO\n");
      continue;
    }

    Serial.printf("%.1f cm\n", distance);
    displayReading(i, distance);
  }

  Serial.println();
}

void testSingleSensor(int sensorIndex) {
  Serial.printf("\n🔍 TESTE DETALHADO - SENSOR %d\n", sensorIndex + 1);
  Serial.println("─────────────────────────────────────\n");

  Serial.println("Realizando 10 leituras...\n");

  float sum = 0;
  int validReadings = 0;
  float minDist = 999;
  float maxDist = 0;

  for (int i = 0; i < 10; i++) {
    float distance = readDistance(sensorIndex);

    Serial.printf("  Leitura %2d: ", i + 1);

    if (distance < 0) {
      Serial.println("❌ ERRO");
    } else {
      Serial.printf("%.2f cm\n", distance);
      sum += distance;
      validReadings++;

      if (distance < minDist) minDist = distance;
      if (distance > maxDist) maxDist = distance;
    }

    delay(200);
  }

  Serial.println();

  if (validReadings > 0) {
    float avg = sum / validReadings;

    Serial.printf("📊 Estatísticas:\n");
    Serial.printf("  Leituras válidas: %d/10\n", validReadings);
    Serial.printf("  Média: %.2f cm\n", avg);
    Serial.printf("  Mínima: %.2f cm\n", minDist);
    Serial.printf("  Máxima: %.2f cm\n", maxDist);
    Serial.printf("  Variação: %.2f cm\n", maxDist - minDist);

    if ((maxDist - minDist) > 2.0) {
      Serial.println("\n⚠️  ATENÇÃO: Variação alta! Verifique:\n");
      Serial.println("  - Objetos próximos ao sensor");
      Serial.println("  - Superfície irregular");
      Serial.println("  - Interferência elétrica");
    } else {
      Serial.println("\n✅ Leituras estáveis!");
    }
  } else {
    Serial.println("❌ Nenhuma leitura válida!");
  }

  Serial.println("\n─────────────────────────────────────\n");
}

void adjustHeight() {
  Serial.println("\n📏 AJUSTE DE ALTURA DO COMPARTIMENTO\n");
  Serial.println("Coloque o sensor no topo do compartimento VAZIO");
  Serial.println("e pressione qualquer tecla...\n");

  while (!Serial.available()) delay(100);
  while (Serial.available()) Serial.read();

  Serial.println("Medindo...\n");

  float distance = readDistanceAverage(0, 10);

  if (distance < 0) {
    Serial.println("❌ Erro ao medir. Tente novamente.\n");
    return;
  }

  Serial.printf("✅ Distância medida: %.1f cm\n\n", distance);
  Serial.println("Atualize no código:");
  Serial.printf("  const float COMPARTMENT_HEIGHT = %.1f;\n\n", distance);
}

// ========================================
// FUNÇÕES DE LEITURA DO SENSOR
// ========================================

float readDistance(int sensorIndex) {
  // Limpar trigger
  digitalWrite(trigPins[sensorIndex], LOW);
  delayMicroseconds(2);

  // Enviar pulso de 10µs
  digitalWrite(trigPins[sensorIndex], HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPins[sensorIndex], LOW);

  // Ler echo com timeout de 30ms (~5m)
  long duration = pulseIn(echoPins[sensorIndex], HIGH, 30000);

  // Verificar timeout
  if (duration == 0) {
    return -1;  // Erro: timeout
  }

  // Calcular distância em cm
  // distância = (tempo × velocidade_som) / 2
  // velocidade_som = 343 m/s = 0.0343 cm/µs
  float distance = (duration * 0.0343) / 2.0;

  // Validar range
  if (distance < MIN_DISTANCE || distance > MAX_DISTANCE) {
    return -1;  // Fora do range válido
  }

  return distance;
}

float readDistanceAverage(int sensorIndex, int samples) {
  float sum = 0;
  int validReadings = 0;

  for (int i = 0; i < samples; i++) {
    float reading = readDistance(sensorIndex);

    if (reading > 0) {
      sum += reading;
      validReadings++;
    }

    delay(10);  // Pequeno delay entre leituras
  }

  if (validReadings == 0) {
    return -1;  // Nenhuma leitura válida
  }

  return sum / validReadings;
}

// ========================================
// FUNÇÕES DE DISPLAY
// ========================================

void displayReading(int sensorIndex, float distance) {
  // Calcular nível
  float level = COMPARTMENT_HEIGHT - distance;

  // Calcular porcentagem
  int percentage = (int)((level / COMPARTMENT_HEIGHT) * 100);

  // Garantir entre 0-100%
  percentage = constrain(percentage, 0, 100);

  // Salvar para comparação
  lastDistances[sensorIndex] = distance;
  lastPercentages[sensorIndex] = percentage;

  // Exibir
  Serial.printf("  Compartimento %d:\n", sensorIndex + 1);
  Serial.printf("    Distância do sensor: %.1f cm\n", distance);
  Serial.printf("    Nível de ração: %.1f cm\n", level);
  Serial.printf("    Porcentagem: %d%%\n", percentage);

  // Barra visual
  Serial.print("    [");
  int bars = percentage / 10;
  for (int j = 0; j < 10; j++) {
    if (j < bars) {
      Serial.print("█");
    } else {
      Serial.print("░");
    }
  }
  Serial.println("]");

  // Status e alertas
  if (percentage < 10) {
    Serial.println("    🔴 CRÍTICO - Reabastça urgente!");
  } else if (percentage < 20) {
    Serial.println("    ⚠️  BAIXO - Reabastecer em breve");
  } else if (percentage < 50) {
    Serial.println("    🟡 MÉDIO");
  } else if (percentage < 80) {
    Serial.println("    🟢 BOM");
  } else {
    Serial.println("    ✅ CHEIO");
  }

  Serial.println();
}

// ========================================
// FUNÇÃO EXTRA: DIAGNÓSTICO
// ========================================

void runDiagnostics() {
  Serial.println("\n========================================");
  Serial.println("   DIAGNÓSTICO DO SISTEMA");
  Serial.println("========================================\n");

  // Teste de pinos
  Serial.println("1️⃣ Testando configuração dos pinos...\n");
  for (int i = 0; i < 3; i++) {
    Serial.printf("  Sensor %d:\n", i + 1);
    Serial.printf("    Trig: GPIO %d (%s)\n", trigPins[i],
                  digitalRead(trigPins[i]) == LOW ? "OK" : "⚠️");
    Serial.printf("    Echo: GPIO %d\n", echoPins[i]);
  }

  Serial.println("\n2️⃣ Testando comunicação com sensores...\n");
  for (int i = 0; i < 3; i++) {
    Serial.printf("  Sensor %d: ", i + 1);

    float distance = readDistance(i);

    if (distance < 0) {
      Serial.println("❌ SEM RESPOSTA");
      Serial.println("    Verifique:");
      Serial.println("    - Conexão VCC (5V)");
      Serial.println("    - Conexão GND");
      Serial.println("    - Conexão Trig/Echo");
      Serial.println("    - Divisor de tensão no Echo");
    } else {
      Serial.printf("✅ OK (%.1f cm)\n", distance);
    }
    Serial.println();
  }

  Serial.println("========================================\n");
}

/*
 * ========================================
 * NOTAS DE USO:
 * ========================================
 *
 * 1. CALIBRAÇÃO:
 *    - Use comando 'A' para medir altura do compartimento
 *    - Atualize COMPARTMENT_HEIGHT no código
 *
 * 2. DIVISOR DE TENSÃO:
 *    - Echo do HC-SR04 emite 5V
 *    - ESP32 suporta apenas 3.3V
 *    - Use resistores 1kΩ + 2kΩ
 *
 * 3. INSTALAÇÃO:
 *    - Posicione sensor perpendicular à superfície
 *    - Mantenha distância mínima de 2cm
 *    - Evite objetos laterais próximos
 *
 * 4. LEITURAS INSTÁVEIS:
 *    - Use comando 'M' para média de leituras
 *    - Verifique interferência
 *    - Certifique-se que superfície é plana
 *
 * 5. INTEGRAÇÃO:
 *    - Este código é para TESTE
 *    - Use ESP32_SaaS_Client.ino para integração completa
 *
 * ========================================
 */
