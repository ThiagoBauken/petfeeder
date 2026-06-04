# 🔌 ESP32 PetFeeder - Funcionamento OFFLINE

## ✅ Sistema 100% Funcional Sem Internet

O ESP32 foi projetado para **funcionar completamente offline** após a configuração inicial.

---

## 📦 O Que é Salvo na Memória Flash

### 1️⃣ **Configuração do Dispositivo**
- ✅ User ID
- ✅ Nome do dispositivo
- ✅ Timezone (GMT/UTC)
- ✅ Credenciais MQTT (para reconexão)
- ✅ Token de autenticação
- ✅ Calibração (steps/gram)

### 2️⃣ **Pets Configurados**
- ✅ ID do pet
- ✅ Nome do pet
- ✅ Quantidade diária (gramas)
- ✅ Compartimento/Motor associado
- ✅ Status (ativo/inativo)

### 3️⃣ **Horários Programados**
- ✅ Hora (0-23)
- ✅ Minuto (0-59)
- ✅ Pet associado (índice)
- ✅ Quantidade a dispensar (gramas)
- ✅ Dias da semana (bitmap: Seg, Ter, Qua, Qui, Sex, Sáb, Dom)
- ✅ Status (ativo/inativo)

---

## 🔄 Ciclo de Vida Completo

### **1. Primeira Configuração (COM Internet)**
```
1. ESP32 liga pela primeira vez
2. Conecta ao WiFi configurado
3. Registra-se no servidor central
4. Recebe configuração inicial:
   - Lista de pets
   - Horários programados
   - Calibração dos motores
5. ✅ SALVA TUDO NA FLASH
```

### **2. Funcionamento Normal (SEM Internet)**
```
1. ESP32 liga
2. ❌ WiFi desconectado ou sem internet
3. ✅ Carrega configuração da FLASH:
   - Pets salvos
   - Horários programados
   - Calibração
4. ✅ RTC (Relógio em Tempo Real) mantém a hora
5. ✅ checkSchedules() executa LOCALMENTE:
   - A cada 1 minuto verifica se há horários
   - Compara hora atual com horários salvos
   - Dispensa comida automaticamente
6. ✅ Motores executam sem precisar de servidor
```

### **3. Reconexão (Internet Volta)**
```
1. ESP32 detecta WiFi disponível
2. Reconecta ao servidor MQTT
3. Sincroniza configurações atualizadas:
   - Novos pets
   - Novos horários
   - Nova calibração
4. ✅ SALVA NOVAMENTE NA FLASH
5. Continua funcionando
```

---

## 🕐 Como os Horários Funcionam Offline

### **RTC (Real-Time Clock) - DS3231**

O ESP32 usa um **módulo RTC externo** que mantém a hora mesmo sem internet:

```cpp
void checkSchedules() {
  // Pega hora do RTC (não precisa de internet!)
  DateTime now = rtc.now();
  int currentHour = now.hour();
  int currentMinute = now.minute();
  int currentDay = now.dayOfTheWeek(); // 0=Domingo, 1=Segunda, etc.

  // Percorre todos os horários salvos na FLASH
  for (int i = 0; i < scheduleCount; i++) {
    // Verifica se está ativo
    if (!schedules[i].active) continue;

    // Verifica se é hoje
    if (!schedules[i].days[currentDay]) continue;

    // Verifica se é agora!
    if (schedules[i].hour == currentHour &&
        schedules[i].minute == currentMinute) {

      // ✅ ALIMENTA O PET LOCALMENTE
      dispenseFeed(schedules[i].petIndex, schedules[i].amount);

      // Espera 61 segundos para evitar duplo trigger
      delay(61000);
    }
  }
}
```

**Esta função executa LOCALMENTE a cada 60 segundos no `loop()`:**
```cpp
// No loop principal do ESP32
if (millis() - lastScheduleCheck > 60000) {
  checkSchedules();  // ← Executa sem internet!
  lastScheduleCheck = millis();
}
```

---

## 💾 Funções de Persistência

### **Salvar Pets**
```cpp
void savePetsToPreferences() {
  // Salva na memória flash do ESP32
  preferences.putString("pet0_name", "Rex");
  preferences.putFloat("pet0_daily", 150.0);
  preferences.putInt("pet0_comp", 0);
  preferences.putBool("pet0_active", true);
  // ... repete para pet1, pet2
}
```

### **Carregar Pets**
```cpp
void loadPetsFromPreferences() {
  // Carrega ao iniciar
  pets[0].name = preferences.getString("pet0_name", "Pet 1");
  pets[0].dailyAmount = preferences.getFloat("pet0_daily", 100.0);
  // ... etc
}
```

### **Salvar Horários**
```cpp
void saveSchedulesToPreferences() {
  preferences.putInt("schedCount", 5); // 5 horários

  // Para cada horário:
  preferences.putInt("sch0_hour", 8);      // 08:00
  preferences.putInt("sch0_min", 0);
  preferences.putFloat("sch0_amt", 30.0);  // 30 gramas
  preferences.putInt("sch0_pet", 0);       // Pet 0 (Rex)
  preferences.putBool("sch0_act", true);   // Ativo

  // Dias da semana (bitmap):
  // bit 0=Domingo, 1=Segunda... 6=Sábado
  byte days = 0b01111110; // Segunda a Sábado
  preferences.putUChar("sch0_days", days);
}
```

### **Carregar Horários**
```cpp
void loadSchedulesFromPreferences() {
  scheduleCount = preferences.getInt("schedCount", 0);

  for (int i = 0; i < scheduleCount; i++) {
    schedules[i].hour = preferences.getInt("sch" + i + "_hour");
    schedules[i].minute = preferences.getInt("sch" + i + "_min");
    schedules[i].amount = preferences.getFloat("sch" + i + "_amt");
    schedules[i].petIndex = preferences.getInt("sch" + i + "_pet");
    schedules[i].active = preferences.getBool("sch" + i + "_act");

    byte days = preferences.getUChar("sch" + i + "_days");
    for (int d = 0; d < 7; d++) {
      schedules[i].days[d] = (days & (1 << d)) != 0;
    }
  }
}
```

---

## 🔋 Bateria do RTC

O módulo RTC DS3231 possui uma **bateria CR2032** que:
- ✅ Mantém a hora por **até 5 anos** sem energia
- ✅ Funciona mesmo com ESP32 desligado
- ✅ Temperatura interna para precisão

**Quando trocar a bateria:**
```cpp
void setupRTC() {
  if (rtc.lostPower()) {
    Serial.println("⚠️ Bateria do RTC esgotada!");
    Serial.println("🔧 Ajustando RTC com hora do compilador...");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }
}
```

---

## 📋 Exemplo de Configuração Salva

### **Cenário: 3 Pets, 5 Horários**

```
╔══════════════════════════════════════════════════════════╗
║                CONFIGURAÇÃO NA FLASH                     ║
╚══════════════════════════════════════════════════════════╝

📦 PETS:
  🐕 Pet 0: Rex (Motor 0) - 150g/dia - ATIVO
  🐈 Pet 1: Mia (Motor 1) - 100g/dia - ATIVO
  🐕 Pet 2: Bob (Motor 2) - 120g/dia - INATIVO

⏰ HORÁRIOS:
  1. 08:00 - Rex (30g) - Seg a Sex
  2. 12:00 - Mia (25g) - Todos os dias
  3. 18:00 - Rex (40g) - Seg a Sex
  4. 20:00 - Mia (30g) - Todos os dias
  5. 22:00 - Rex (35g) - Sáb e Dom

⚙️ CALIBRAÇÃO:
  STEPS_PER_GRAM = 41.0
```

**Esta configuração PERMANECE no ESP32 mesmo:**
- ❌ Sem WiFi
- ❌ Sem Internet
- ❌ Sem servidor
- ❌ ESP32 desligado e religado

---

## 🎯 Fluxo de Execução Offline

```
┌─────────────────────────────────────────────┐
│         ESP32 LIGA (SEM INTERNET)           │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│   loadPetsFromPreferences()                 │
│   → Carrega "Rex", "Mia", "Bob"             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│   loadSchedulesFromPreferences()            │
│   → Carrega 5 horários programados          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│   setupRTC()                                │
│   → RTC informa: 08:00 (Segunda-feira)      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│   loop() - Executa continuamente:           │
│                                             │
│   ⏱️  A cada 60 segundos:                   │
│      checkSchedules()                       │
│                                             │
│   ✅ 08:00 = MATCH!                         │
│      Horário 1: Rex - 30g                   │
│      → dispenseFeed(0, 30.0)                │
│      → Motor 0 gira (30g × 41 = 1230 steps) │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│   🍽️  REX FOI ALIMENTADO!                   │
│   Próximo horário: 12:00 (Mia)              │
└─────────────────────────────────────────────┘
```

---

## 🚨 Importante

### ✅ **Funciona Offline:**
- Executar horários programados
- Dispensar comida manualmente (botão físico)*
- Ler sensores de nível
- Controlar motores
- Manter data/hora no RTC

### ❌ **NÃO Funciona Offline:**
- Sincronizar com servidor/app
- Enviar telemetria (níveis, temperatura)
- Receber comandos remotos do app
- Enviar notificações
- Atualizar firmware (OTA)
- Alterar configurações via app

### 🔄 **Sincroniza Quando Volta Online:**
- Envia histórico de alimentações
- Envia telemetria acumulada
- Recebe novos horários
- Atualiza configurações

---

## 🛠️ Hardware Necessário

### **Mínimo para Funcionar Offline:**
```
1. ESP32
2. Motor 28BYJ-48 + Driver ULN2003
3. RTC DS3231 com bateria CR2032 ← ESSENCIAL!
4. Fonte de alimentação 5V 2A
```

### **Opcional (Melhora o Sistema):**
```
5. Sensor HC-SR04 (nível de ração)
6. Sensor DS18B20 (temperatura)
7. Botão físico (alimentação manual)
8. LED indicador (status)
```

---

## 🧪 Teste de Funcionamento Offline

### **Teste 1: Desligar WiFi**
```
1. Configure 1 horário para daqui a 2 minutos
2. Espere o ESP32 salvar na flash
3. Desligue o roteador WiFi
4. ✅ No horário programado, deve alimentar normalmente!
```

### **Teste 2: Reiniciar ESP32**
```
1. Configure horários
2. Espere salvar na flash
3. Desligue e religue o ESP32
4. Monitor Serial deve mostrar:
   📂 Carregando 5 horários da flash...
   ✅ Horários carregados da flash
      ⏰ Horário 1: 08:00 - Pet 0 - 30.0g - ATIVO
      ⏰ Horário 2: 12:00 - Pet 1 - 25.0g - ATIVO
      ...
```

### **Teste 3: Sem Internet por Dias**
```
1. Configure tudo
2. Desconecte da internet
3. ESP32 deve continuar alimentando nos horários por:
   - Dias
   - Semanas
   - Meses
   - Anos! (enquanto houver energia)
```

---

## 📊 Logs do Monitor Serial

### **Boot Offline com Sucesso:**
```
╔══════════════════════════════════════╗
║     PetFeeder SaaS Client v1.0       ║
╚══════════════════════════════════════╝

Device ID: PF_AABBCC001122

💾 Carregando configuração...
✅ Configuração carregada da flash

📂 Carregando 3 pets da flash...
   🐕 Pet 0: Rex - 150.0g/dia - Motor 0
   🐈 Pet 1: Mia - 100.0g/dia - Motor 1
   🐕 Pet 2: Bob - 120.0g/dia - Motor 2 (INATIVO)
✅ Pets carregados da flash

📂 Carregando 5 horários da flash...
   ⏰ Horário 1: 08:00 - Pet 0 - 30.0g - ATIVO
   ⏰ Horário 2: 12:00 - Pet 1 - 25.0g - ATIVO
   ⏰ Horário 3: 18:00 - Pet 0 - 40.0g - ATIVO
   ⏰ Horário 4: 20:00 - Pet 1 - 30.0g - ATIVO
   ⏰ Horário 5: 22:00 - Pet 0 - 35.0g - ATIVO
✅ Horários carregados da flash

🕐 RTC iniciado: 2024-01-15 08:00:00

📶 Conectando WiFi... ❌
⚠️  Modo OFFLINE ativado

✅ Sistema iniciado em MODO OFFLINE!
   Horários programados serão executados normalmente.
```

---

## ✨ Conclusão

O ESP32 PetFeeder é **100% autônomo**:

1. ✅ **Configure uma vez** via WiFi/app
2. ✅ **Salva tudo** na memória flash
3. ✅ **Funciona para sempre** mesmo sem internet
4. ✅ **RTC mantém a hora** com bateria
5. ✅ **Sincroniza quando online** para atualizações

**É como um relógio despertador programável!** 🕐🍽️🐕
