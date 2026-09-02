# Pinagem oficial — PetFeeder

> **Esta é a única fonte de verdade sobre pinos.**
> Os valores abaixo vêm direto do firmware em
> [`PetFeeder_WiFiSetup/PetFeeder_WiFiSetup.ino`](../../PetFeeder_WiFiSetup/PetFeeder_WiFiSetup.ino)
> (bloco `CONFIGURACOES`, linhas 46-57). Se algum outro documento divergir daqui,
> **este vale** — ou o firmware foi alterado e este arquivo precisa ser atualizado junto.

## ⚠️ Antes de ligar qualquer coisa

O projeto atual usa **um motor e um sensor**. Guias mais antigos neste repositório
descrevem um conceito de **três motores e três sensores** que **não existe no firmware**.
Seguir aqueles diagramas coloca o sensor em pinos que o firmware dirige como **saída de
motor** — o ECHO (5 V) contra uma saída push-pull do ESP32 é contenção elétrica e pode
danificar a placa.

## Tabela oficial

| Componente | Sinal | GPIO | Observação |
|---|---|---|---|
| Motor 28BYJ-48 (via ULN2003) | IN1 | **16** | saída |
| Motor 28BYJ-48 (via ULN2003) | IN2 | **17** | saída |
| Motor 28BYJ-48 (via ULN2003) | IN3 | **18** | saída |
| Motor 28BYJ-48 (via ULN2003) | IN4 | **19** | saída |
| ULN2003 | VCC / GND | 5V / GND | alimente o motor por fonte externa, não pelo USB |
| HC-SR04 | TRIG | **26** | saída |
| HC-SR04 | ECHO | **25** | entrada — **exige divisor de tensão** (ver abaixo) |
| HC-SR04 | VCC | 5V | o sensor **não** funciona com 3,3 V |
| HC-SR04 | GND | GND | terra comum com o ESP32 |
| LED de status | — | **2** | LED onboard da maioria das placas DevKit |
| Botão de reset de configuração | — | **0** | é o botão **BOOT** da placa; segurar 3 s limpa a configuração |

Todos os GNDs (ESP32, ULN2003, sensor e fonte) precisam estar **no mesmo terra**.

## Divisor de tensão obrigatório no ECHO

O HC-SR04 é alimentado com 5 V e o pino ECHO devolve **5 V**. As entradas do ESP32
toleram **3,3 V**. Ligar direto degrada o pino com o tempo.

```
HC-SR04 ECHO ──┬── R1 (1 kΩ) ──┬── GPIO 25 (ESP32)
               │               │
               │             R2 (2 kΩ)
               │               │
              ( )             GND
```

Com R1 = 1 kΩ e R2 = 2 kΩ, a tensão no GPIO fica em 5 × 2/(1+2) ≈ **3,3 V**.
O TRIG (GPIO 26) é saída do ESP32 e **não** precisa de divisor.

## Pinos que NÃO devem ser usados

| GPIO | Motivo |
|---|---|
| 6–11 | ligados à memória flash interna — usar trava a placa |
| 34, 35, 36, 39 | **somente entrada**, sem resistor de pull-up interno |
| 0, 2, 12, 15 | pinos de strap (boot) — o nível deles no boot muda o modo de inicialização |

O GPIO 0 é usado aqui de propósito, mas apenas como **botão** (pull-up interno,
lido depois do boot), o que é seguro.

## Se você mudar a pinagem

1. Edite os `#define` em `PetFeeder_WiFiSetup/PetFeeder_WiFiSetup.ino` (linhas 46-57).
2. Atualize **esta tabela**.
3. Ajuste os sketches de bancada em [`examples/`](../../examples), que seguem esta mesma pinagem.

## Calibração

A pinagem define *onde* ligar; a quantidade de ração por dose depende do seu mecanismo.
Veja [`GUIA_CALIBRACAO.md`](GUIA_CALIBRACAO.md). No firmware, as doses estão em **passos
do motor** (`DOSE_SMALL`, `DOSE_MEDIUM`, `DOSE_LARGE`), não em gramas.
