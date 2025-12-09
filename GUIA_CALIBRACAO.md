# 🎯 GUIA DE CALIBRAÇÃO - PetFeeder ESP32

## ⚙️ CALIBRAÇÃO DO MOTOR = PESO REAL DA RAÇÃO

Como você disse: **"Tamanho da porção = tempo que motor fica ativo"**

O sistema está **preparado para calibração real**!

---

## 📐 COMO FUNCIONA

### **Fórmula Atual:**
```cpp
steps = amount × STEPS_PER_GRAM

Exemplo:
- Quero dispensar 30g
- STEPS_PER_GRAM = 41 (valor padrão de fábrica)
- steps = 30 × 41 = 1230 steps
- Motor gira 1230 passos = ~0.6 voltas
```

### **Problema:**
❌ O valor `STEPS_PER_GRAM = 41` é uma **ESTIMATIVA**!

O peso real varia com:
- Tamanho dos grãos de ração (pequena, média, grande)
- Densidade da ração (seca, úmida)
- Formato do recipiente
- Ângulo de descida
- Umidade do ar

### **Solução:**
✅ **CALIBRAR com ração REAL após montar!**

---

## 🧪 PROCESSO DE CALIBRAÇÃO

### **1. Monte o Hardware Completo**
```
- ESP32 ligado
- Motor instalado no recipiente
- Ração no recipiente
- Balança de cozinha embaixo
```

### **2. Teste Inicial (Valor Padrão)**

#### Via Monitor Serial:
```cpp
// O ESP32 aceita comando de calibração via MQTT
// Ou você pode testar direto no código

void setup() {
  // ...

  // TESTE: Dispensar quantidade conhecida
  Serial.println("🧪 TESTE DE CALIBRAÇÃO");
  Serial.println("Coloque tigela na balança e zere");
  delay(5000); // 5 segundos para você zerar

  // Dispensa 30g (segundo cálculo padrão)
  dispenseFeed(0, 30.0);

  Serial.println("⏳ Aguarde motor parar...");
  while(motorRunning[0]) {
    stepMotor(0);
  }

  Serial.println("⚖️ Pese a ração dispensada!");
  Serial.println("Digite o peso REAL na balança");
}
```

#### **Exemplo de Resultado:**
```
🧪 TESTE DE CALIBRAÇÃO
Coloque tigela na balança e zere
🍽️ Dispensando 30.0g (1230 steps)
⏳ Aguarde motor parar...
⚖️ Pese a ração dispensada!

Peso REAL na balança: 25g  ← DIFERENTE!
```

### **3. Calcular STEPS_PER_GRAM Real**

#### **Fórmula:**
```
STEPS_PER_GRAM_REAL = steps_executados / peso_real

Exemplo:
- Steps executados: 1230
- Peso esperado: 30g
- Peso REAL: 25g

STEPS_PER_GRAM_REAL = 1230 / 25 = 49.2
```

#### **Ou Inverta:**
```
STEPS_PER_GRAM_REAL = (amount_esperado × STEPS_PER_GRAM_ATUAL) / peso_real

Exemplo:
- Amount esperado: 30g
- STEPS_PER_GRAM atual: 41
- Peso REAL: 25g

STEPS_PER_GRAM_REAL = (30 × 41) / 25 = 49.2
```

### **4. Atualizar o Valor no ESP32**

#### **Opção A: Pelo Site/App**
```
1. Acesse aba "Configurações"
2. Seção "Calibração do Motor"
3. Digite novo valor: 49.2
4. Clique "Salvar"
5. ✅ ESP32 recebe via MQTT e salva na flash!
```

#### **Opção B: Direto no Código**
```cpp
// No ESP32_SaaS_Client.ino linha 51:
float STEPS_PER_GRAM = 49.2;  // ← ALTERE AQUI

// Ou após setup:
void setup() {
  // ...
  STEPS_PER_GRAM = 49.2;
  preferences.putFloat("stepsPerGram", STEPS_PER_GRAM);
  Serial.println("✅ Nova calibração salva: 49.2 steps/g");
}
```

#### **Opção C: Via Comando MQTT**
```json
{
  "command": "updateConfig",
  "stepsPerGram": 49.2
}
```

---

## 🔬 CALIBRAÇÃO PRECISA (Método Científico)

### **Materiais:**
- Balança de cozinha digital (precisão 1g)
- Tigela pequena
- Ração do seu pet
- Papel e caneta

### **Procedimento:**

#### **1. Múltiplos Testes:**
```
Teste 1: Solicite 20g → Meça peso real → Anote
Teste 2: Solicite 30g → Meça peso real → Anote
Teste 3: Solicite 50g → Meça peso real → Anote
Teste 4: Solicite 100g → Meça peso real → Anote
```

#### **2. Tabela de Resultados:**
```
| Teste | Solicitado | Steps | Real | Erro | Ajuste Necessário |
|-------|------------|-------|------|------|-------------------|
| 1     | 20g        | 820   | 16g  | -4g  | +25%              |
| 2     | 30g        | 1230  | 25g  | -5g  | +20%              |
| 3     | 50g        | 2050  | 42g  | -8g  | +19%              |
| 4     | 100g       | 4100  | 85g  | -15g | +18%              |
```

#### **3. Calcular Média:**
```
Média de ajuste: (25% + 20% + 19% + 18%) / 4 = 20.5%

STEPS_PER_GRAM_NOVO = STEPS_PER_GRAM_ATUAL × 1.205
STEPS_PER_GRAM_NOVO = 41 × 1.205 = 49.4
```

#### **4. Validar:**
```
Teste 5: Solicite 30g com novo valor (49.4)
         → Deveria dar ~30g real
         → Se der 28-32g = ✅ CALIBRADO!
```

---

## 📊 TABELA DE CALIBRAÇÃO POR TIPO DE RAÇÃO

### **Valores de Referência (Aproximados):**

| Tipo de Ração | Tamanho Grão | STEPS_PER_GRAM | Observação |
|---------------|--------------|----------------|------------|
| Ração Gato Adulto | Pequeno (5mm) | 45-55 | Grãos pequenos = mais steps |
| Ração Gato Filhote | Muito Pequeno (3mm) | 50-60 | Grãos miúdos = muito mais steps |
| Ração Cão Pequeno | Médio (8mm) | 38-48 | Tamanho médio |
| Ração Cão Médio | Grande (12mm) | 30-40 | Grãos grandes = menos steps |
| Ração Cão Grande | Muito Grande (15mm) | 25-35 | Grãos muito grandes |
| Ração Úmida | - | Não recomendado | Use dispensador diferente |

**Estes são valores ESTIMADOS!** Sempre calibre com SUA ração específica!

---

## 🎛️ INTERFACE DE CALIBRAÇÃO (Frontend)

### **Já Implementado no Site:**

#### **Aba Configurações → Calibração:**
```html
┌───────────────────────────────────────────┐
│  ⚙️ CALIBRAÇÃO DO MOTOR                   │
├───────────────────────────────────────────┤
│                                           │
│  Steps por Grama:                         │
│  [ 41.0 ]  ←─────────── Digite aqui      │
│                                           │
│  [Salvar Calibração]                      │
│                                           │
│  ℹ️ Dica: Dispense 30g e pese na balança.│
│    Ajuste até o peso ficar correto.      │
│                                           │
│  📝 Histórico de Calibrações:             │
│  • 15/01/2024 - 41.0 (padrão)             │
│  • 16/01/2024 - 49.2 (ajustado)           │
│  • 17/01/2024 - 48.5 (refinado)           │
│                                           │
└───────────────────────────────────────────┘
```

### **Código JavaScript (script.js):**
```javascript
function saveMotorCalibration() {
  const stepsPerGram = parseFloat(document.getElementById('steps-per-gram').value);

  if (stepsPerGram < 10 || stepsPerGram > 100) {
    showNotification('Erro', 'Valor inválido! Use entre 10-100', 'error');
    return;
  }

  // Salva localmente
  localStorage.setItem('motor_calibration', stepsPerGram);

  // Envia para ESP32 via backend
  fetch('/api/devices/' + deviceId + '/calibrate', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      stepsPerGram: stepsPerGram
    })
  })
  .then(response => response.json())
  .then(data => {
    showNotification('Sucesso', 'Calibração salva!', 'success');

    // Registra no histórico
    addCalibrationHistory(stepsPerGram);
  });
}
```

---

## 🧮 CALCULADORA DE CALIBRAÇÃO

### **Modo Fácil:**

```
Você testou:
- Pediu: 30g
- Motor deu: 1230 steps (30 × 41)
- Balança mostrou: 25g

Novo valor:
STEPS_PER_GRAM = 1230 / 25 = 49.2

✅ Use 49.2 no sistema!
```

### **Modo Avançado (Múltiplos Testes):**

```python
# Script Python para calcular melhor valor

testes = [
    {'pedido': 20, 'real': 16},
    {'pedido': 30, 'real': 25},
    {'pedido': 50, 'real': 42},
    {'pedido': 100, 'real': 85}
]

STEPS_PER_GRAM_ATUAL = 41

# Calcula fator de ajuste para cada teste
fatores = []
for teste in testes:
    steps_executados = teste['pedido'] * STEPS_PER_GRAM_ATUAL
    fator = steps_executados / teste['real']
    fatores.append(fator)
    print(f"Teste {teste['pedido']}g: fator = {fator:.2f}")

# Média dos fatores
media_fator = sum(fatores) / len(fatores)
print(f"\n✅ STEPS_PER_GRAM ideal: {media_fator:.2f}")

# Saída:
# Teste 20g: fator = 51.25
# Teste 30g: fator = 49.20
# Teste 50g: fator = 48.81
# Teste 100g: fator = 48.24
#
# ✅ STEPS_PER_GRAM ideal: 49.38
```

---

## 🎯 PROCEDIMENTO RÁPIDO DE CALIBRAÇÃO

### **Para Quando Você Montar:**

#### **Passo 1: Teste Inicial**
```
1. Monte tudo
2. Coloque ração no recipiente
3. Coloque tigela na balança
4. Zere a balança
5. No site: clique "Alimentar" → 30g
6. Espere motor parar
7. Leia peso na balança
```

#### **Passo 2: Ajustar**
```
Se mostrou 25g (ao invés de 30g):

Cálculo rápido:
Novo valor = 41 × (30 / 25) = 41 × 1.2 = 49.2

No site:
1. Vá em Configurações
2. Steps/Gram: digite 49.2
3. Salve
```

#### **Passo 3: Validar**
```
1. Teste novamente: 30g
2. Se der 28-32g = ✅ OK!
3. Se ainda tiver erro: repita ajuste
```

---

## 🔧 AJUSTES FINOS

### **Variação por Compartimento:**

Você pode ter calibrações diferentes por motor:

```javascript
// No frontend (script.js)
const motorCalibrations = {
  motor1: 49.2,  // Ração de gato (grãos pequenos)
  motor2: 41.0,  // Ração de cão médio
  motor3: 35.5   // Ração de cão grande
};

function dispenseFeed(petIndex, amount) {
  const motor = pets[petIndex].motor;
  const stepsPerGram = motorCalibrations[`motor${motor + 1}`];
  const steps = amount * stepsPerGram;

  // Envia comando para ESP32
  sendCommand({
    command: 'feed',
    petIndex: petIndex,
    amount: amount,
    steps: steps  // Envia steps já calculado
  });
}
```

### **No ESP32:**
```cpp
// Aceita tanto 'amount' quanto 'steps' diretamente
void handleCommand(JsonDocument& doc) {
  if (cmd == "feed") {
    int petIndex = doc["petIndex"];

    // Opção 1: Backend envia steps já calculados
    if (doc.containsKey("steps")) {
      int steps = doc["steps"];
      targetSteps[petIndex] = steps;
      motorRunning[petIndex] = true;
    }
    // Opção 2: Calcula localmente
    else {
      float amount = doc["amount"];
      dispenseFeed(petIndex, amount);
    }
  }
}
```

---

## 📝 REGISTRO DE CALIBRAÇÃO

### **Crie um Log de Calibrações:**

```
Data: 16/01/2024
Ração: Whiskas Adulto Frango
Tamanho Grão: Pequeno (~5mm)
Motor: 1
Calibração Anterior: 41.0

Testes:
- 20g solicitado → 16.5g real
- 30g solicitado → 24.8g real
- 50g solicitado → 41.2g real

Cálculo:
Média erro: ~20%
STEPS_PER_GRAM novo: 49.5

Validação:
- 30g solicitado → 29.8g real ✅

✅ Calibração aprovada: 49.5 steps/g
```

---

## 💡 DICAS IMPORTANTES

### **Ao Calibrar:**
- ✅ Use balança com precisão de 1g ou melhor
- ✅ Zere a balança antes de cada teste
- ✅ Faça pelo menos 3 testes
- ✅ Use quantidade média (20-50g) para calibrar
- ✅ Calibre com recipiente VAZIO e depois CHEIO
- ✅ Temperatura e umidade podem afetar

### **Manutenção:**
- 🔄 Recalibre a cada troca de marca/tipo de ração
- 🔄 Recalibre se perceber porções erradas
- 🔄 Recalibre a cada 3 meses (desgaste do motor)

### **Tolerância Aceitável:**
```
±10% = OK         (27-33g para pedido de 30g)
±15% = Razoável   (25.5-34.5g para pedido de 30g)
±20% = Recalibrar (24-36g para pedido de 30g)
```

---

## 🎉 CONCLUSÃO

### **Sistema Pronto para Calibração Real:**

✅ **Valor padrão:** 41.0 steps/gram (estimativa)
✅ **Você ajusta:** Após montar e testar com SUA ração
✅ **Sistema salva:** Na flash do ESP32 + backend
✅ **Calibração permanente:** Funciona offline
✅ **Ajuste fino:** Pode ter valor diferente por motor

### **Quando Montar:**

1. ✅ Teste com valor padrão (41.0)
2. ✅ Meça peso real na balança
3. ✅ Calcule novo valor
4. ✅ Salve no sistema
5. ✅ Valide com novo teste
6. ✅ Ajuste fino se necessário

**O sistema está 100% preparado para calibração customizada!** 🎯

**Traga os dados reais quando testar e fazemos ajuste fino!** 📊
