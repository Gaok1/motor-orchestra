# Protótipo físico

Plano para levar a Sinfonia de Motores do navegador para motores de verdade. Nada disto foi montado ainda: são escolhas de projeto e estimativas, a validar na bancada (ver [Roteiro](#roteiro)).

    app (navegador) ──USB-MIDI──▶ microcontrolador ──STEP/DIR──▶ drivers ──▶ motores ──▶ caixa de madeira
         arranjo                    1 gerador por motor           corrente = volume

O app continua fazendo o que já faz (transcrição e arranjo em N linhas monofônicas). O microcontrolador só transforma cada linha num trem de pulsos, e o som vem da vibração dos motores presos numa caixa de ressonância.

## Motores

**NEMA 17 de 1,8° (200 passos por volta).** Barato, fácil de achar (padrão de impressora 3D) e o mais usado em projetos musicais. O torque não importa, porque o motor não move carga.

- **Corpo médio, ~40 mm, 1,5–1,7 A (17HS4401):** a escolha padrão para todas as vozes.
- **Corpo curto, ~20–28 mm ("pancake", 17HS2408):** rotor mais leve, ataques mais rápidos. Bom para a melodia, e mais barato.
- **NEMA 23:** não vale a pena. O rotor pesado atrapalha os ataques e o grave do NEMA 17 já basta.

Pela hipótese do simulador (nota = passos completos por segundo), o Fá♯6, topo da melodia no modo *Papéis*, pede 1480 passos/s, ou 444 RPM, ao alcance de um NEMA 17 com driver a 24 V. O limite real está na partida: acima da *pull-in rate* (taxa máxima de partida sem rampa), o motor zumbe e não gira. O firmware precisa de uma rampa de poucos ms nas notas agudas, que é o que o parâmetro *Inércia* do simulador representa.

### Alternativas mais baratas

| Opção | Custo por voz (motor + driver) | Prós | Contras |
|---|---|---|---|
| NEMA 17 fraco (17HS2408, 0,6 A) + A4988 | R$ 45–60 | Mesmo circuito da versão final, menos calor | Um pouco menos de volume |
| NEMA 17 usado (impressora 3D) + A4988 | R$ 30–50 | Bom motor pela metade do preço | Modelos diferentes; afinação por motor |
| 28BYJ-48 + ULN2003 | R$ 12–20 | O mais barato novo, 5 V | Agudos limitados (estimativa: até Dó5–Lá5), som fraco, ruído da redução, 4 pinos por motor (máx. ~7 no Pico 2) |
| Drive de disquete (estilo Moppy) | R$ 0–40 (sucata) | Driver embutido, só STEP/DIR | 80 trilhas: o firmware inverte a direção; fonte de PC 5/12 V |
| Motor de drive de CD/DVD + A4988 | ~R$ 10 (driver) | De graça | Muito baixo |

**Micro motor DC (3–6 V, ~R$ 3):** não substitui o motor de passo. A rotação depende de tensão, atrito, temperatura e desgaste, então afinar pela rotação exigiria sensor e malha fechada, e os ataques levam dezenas de ms. Ele afina bem como alto-falante: uma onda quadrada na frequência da nota, com duty cycle baixo (~10–30%) para quase não girar. Só que aí o motor não gira, o timbre é de buzzer, e um piezo de R$ 1 faz o mesmo melhor. Serve no máximo para testar firmware e MIDI.

## Drivers

| Driver | Som | Volume dinâmico | Observação |
|---|---|---|---|
| A4988 / DRV8825 | Alto e áspero, o som clássico | Não: corrente fixa no potenciômetro | Baratos, para começar |
| TMC2209 em SpreadCycle | Configurável | Sim: corrente por UART | Versão final |

O modo padrão do TMC2209 (StealthChop) foi feito para silenciar o motor. Configure por UART: SpreadCycle ligado, interpolação para 256 micropassos (`intpol`) desligada, micropassos baixos (1/1 a 1/4). Com isso:

- a corrente (`IRUN`, 0–31) vira a intensidade da nota (`vel`, *Volume por importância*);
- os micropassos mudam o timbre, como o controle *Micropassos* do simulador;
- até 4 drivers dividem um barramento UART, com endereços 0–3 nos pinos MS1/MS2.

No A4988, ajuste o Vref para ~0,6–0,8 A: esquenta menos e o som quase não muda. Comece em passo completo (sem jumpers MS), que é o som mais forte e a referência do simulador (`micro: 1`).

## Microcontrolador

**Raspberry Pi Pico 2 (RP2350).** O que decide é a afinação. O Moppy no Arduino gera passos num timer de 40 µs; no Fá♯6 o período é ~676 µs, então o erro chega a ~6%, quase um semitom. O PIO do RP2350 tem 12 máquinas de estado (8 no RP2040), cada uma gerando uma onda quadrada com resolução de ciclo de clock: até 12 motores afinados, o mesmo limite que `scripts/audit-arrangements.mjs` testa. O vibrato (*bends*) é só a troca do registrador de período.

Alternativas:

- **Arduino Uno + CNC Shield V3:** 4 drivers encaixáveis, sem solda, com firmware pronto ([Moppy2](https://github.com/samphonic/Moppy2)). Desafina nos agudos.
- **ESP32:** LEDC ou RMT funcionam; temporização um pouco menos determinística que o PIO.

### Pico 2 com o CNC Shield V3

O shield não encaixa no Pico; ligue com jumpers nos pinos STEP/DIR/EN do header Uno. O shield alimenta a lógica dos A4988 com 5 V, e aí o nível alto mínimo é 0,7 × VDD = 3,5 V, acima dos 3,3 V do Pico. Alimente o pino de 5 V do shield com os **3,3 V do Pico**: o A4988 aceita lógica de 3 a 5,5 V, e 3,3 V passa a ser um nível alto válido.

## Protocolo: USB-MIDI

O firmware se apresenta como dispositivo MIDI USB (classe MIDI do TinyUSB):

| MIDI | Motor |
|---|---|
| canal *n* | motor *n* |
| `note on` / `note off` | liga / desliga a nota |
| `velocity` | corrente (TMC2209) |
| `pitch bend` (14 bits) | vibrato e deslizes |

No app, a Web MIDI API (Chrome) aceita `output.send(bytes, timestamp)` com horário agendado, o mesmo esquema de *lookahead* de `engine.mjs` (`LOOKAHEAD = 0.12`). Isso cabe num terceiro modo ao lado de “A · Ideal” e “B · Mecânico”: “C · Físico”, que agenda MIDI em vez de osciladores. Qualquer DAW ou arquivo `.mid` também toca a orquestra. Os limites físicos (rampa, velocidade máxima) ficam no firmware.

## Mecânica e acústica

O som vem do que está preso no motor, não do motor.

- Parafuse cada motor direto numa tampa de compensado ou MDF fino (3–6 mm) de uma caixa oca, como o tampo de um violão. Sem coxim de borracha entre motor e tampa.
- Isole a caixa da mesa com pés de borracha.
- Um disco leve no eixo mostra qual motor toca; peso aumenta a inércia.
- Desligue o motor (pino `EN`) quando a voz estiver em silêncio: parado e energizado, ele esquenta e chia.

## Alimentação

- Fonte de 24 V (12 V serve no protótipo). Com ~1 A por fase, conte 0,5–1 A da fonte por motor ativo. Para 12 motores, 24 V e 10–15 A (ex.: Mean Well LRS-350-24).
- Eletrolítico de 100 µF/35 V junto a cada driver.
- Nunca desconecte um motor com o driver ligado: queima o driver.

## Custos

Estimativas de novembro de 2026, não consultadas em loja. “AliExpress” inclui impostos na faixa de compras até US$ 50 (~20% + ICMS). Pedidos acima disso pagam bem mais: divida o pedido ou conte 25–35% a mais nessa parte.

### Preço por item

| Item | Brasil (un.) | AliExpress (un.) |
|---|---|---|
| Raspberry Pi Pico 2 | R$ 45–70 | R$ 35–50 |
| TMC2209 (módulo BTT/FYSETC) | R$ 25–45 | R$ 20–30 |
| A4988 | R$ 8–15 | R$ 5–8 |
| DRV8825 | R$ 12–20 | R$ 7–10 |
| NEMA 17 ~40 mm (17HS4401) | R$ 50–90 | R$ 45–60 |
| NEMA 17 curto (~23 mm) | R$ 45–80 | R$ 40–55 |
| Fonte 24 V 5 A genérica | R$ 50–80 | R$ 40–60 |
| Fonte Mean Well LRS-350-24 | R$ 250–400 | — |
| Capacitor 100 µF/35 V | R$ 0,50–1 | kit R$ 10 |
| Placa perfurada, pinos, bornes, fios | R$ 30–60 (lote) | R$ 20–40 |
| Compensado/MDF para a caixa | R$ 30–80 | — |
| Arduino Uno + CNC Shield V3 | R$ 60–90 | R$ 35–50 |

### Protótipo de 4 motores (TMC2209)

| Item | Qtd | Brasil | AliExpress (fonte e caixa compradas aqui) |
|---|---|---|---|
| Pico 2 | 1 | 45–70 | 35–50 |
| TMC2209 | 4 | 100–180 | 80–120 |
| NEMA 17 ~40 mm | 4 | 200–360 | 180–240 |
| Fonte 24 V 5 A | 1 | 50–80 | 50–80 |
| Capacitor 100 µF | 4 | 2–4 | 10 |
| Placa, pinos, bornes, fios | lote | 30–60 | 20–40 |
| Caixa | 1 | 30–80 | 30–80 |
| **Total** | | **R$ 457–834** | **R$ 405–620** |

Com A4988 no lugar dos TMC2209: R$ 389–714 no Brasil.

### Versão de 12 motores (TMC2209 + Mean Well)

| Item | Qtd | Brasil | AliExpress (fonte e caixa compradas aqui) |
|---|---|---|---|
| Pico 2 | 1 | 45–70 | 35–50 |
| TMC2209 | 12 | 300–540 | 240–360 |
| NEMA 17 ~40 mm | 12 | 600–1.080 | 540–720 |
| Mean Well LRS-350-24 | 1 | 250–400 | 250–400 |
| Capacitor 100 µF | 12 | 6–12 | 10–15 |
| Placa, pinos, bornes, fios | lote ×2 | 60–120 | 40–80 |
| Caixas | 2 | 60–160 | 60–160 |
| **Total** | | **R$ 1.321–2.382** | **R$ 1.175–1.785** |

### Configurações mais baratas (4 vozes)

| Configuração | Total estimado |
|---|---|
| NEMA 17 + TMC2209 (acima) | R$ 457–834 |
| NEMA 17 fraco + A4988 + fonte 12 V | R$ 300–420 |
| NEMA 17 usado + A4988 | R$ 250–350 |
| 28BYJ-48 + ULN2003 + fonte 5 V | R$ 160–230 |
| Micro motor DC como alto-falante + 2 DRV8833 | R$ 150–240 |
| Disquetes de sucata + fonte de PC velha | R$ 100–150 |

### Kit candidato

[NEMA 17 17HS4401S + CNC Shield V3 + 4 × A4988](https://pt.aliexpress.com/item/1005008810702233.html) (AliExpress). Traz os motores e drivers da versão barata; falta o microcontrolador (Uno ou Pico 2), a fonte de 12–24 V e a caixa. O preço não aparece sem JavaScript: compensa se a variante de 4 motores custar menos que as peças avulsas, ~R$ 215–290.

Caminho sugerido: kit + Uno clone com Moppy2 para ouvir os motores logo; depois trocar o Uno pelo Pico 2, reaproveitando shield, drivers e motores.

## Roteiro

1. **Bancada com um motor.** Pico, um driver e um motor tocando uma escala. Grave com microfone e veja o espectro: o pico tem que estar na taxa de passos completos, como o simulador supõe (o README chama isso de escolha, não lei). Se aparecer num sub-múltiplo, use uma tabela de afinação por motor.
2. **Medir e devolver ao simulador.** Nota mais alta que parte sem rampa, velocidade máxima, ressonância da caixa, notas que perdem passo. Esses números substituem `DEFAULT_PHYSICS` em `physics.mjs`, e o modelo B passa a prever o protótipo.
3. **Quatro motores com USB-MIDI** e o modo “C · Físico” no app.
4. **8 a 12 motores**, corrente por UART e caixa definitiva.
