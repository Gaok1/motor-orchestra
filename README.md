# Sinfonia de Motores

Uma orquestra de motores de passo virtuais no navegador. Cada motor toca uma nota por vez, com o som produzido pela vibração dos passos, como nos projetos de floppies e motores musicais ([Moppy2](https://github.com/samphonic/Moppy2)). Você pode tocar notas e acordes à mão, usar três demonstrações, escrever uma partitura ou colar um link do YouTube: o app transcreve a música e faz um arranjo dela para os motores.

O objetivo é provar o conceito antes de um protótipo físico. Ouvir a diferença entre a síntese ideal e a mecânica, e ver onde os limites do motor atrapalham a música.

## Rodar

    cd ~/Pessoal/motor-orchestra
    ./run.sh

Abra <http://127.0.0.1:8001>. A porta é diferente da do PyMusicLooper (8000), então os dois podem rodar juntos. Na primeira execução, ou quando `requirements.txt` mudar, o script prepara o ambiente Python em `.venv` (precisa de `uv`, Python 3.10+ e Node.js para o yt-dlp). Em NixOS, ele acha sozinho a `libstdc++` e a `libz` de 64 bits que o numpy precisa. Ctrl+C encerra.

O áudio só começa depois do primeiro clique, por regra dos navegadores.

## Como usar

- **Ouvir um motor:** “▶ Nota” no cartão do motor. Trocar a nota no seletor muda o comando, os pulsos, a rotação e o som.
- **Acorde:** “Acorde de Lá maior” liga os três motores em Lá4 (440 Hz), Dó♯5 (554,37 Hz) e Mi5 (659,26 Hz).
- **Sequências:** escolha *Escala*, *Acordes* ou *Engrenagens* e aperte “▶ Tocar”. *Acordes* e *Engrenagens* têm 4 vozes; com 3 motores a quarta aparece cinza no rolo, e “+ Motor” a faz tocar.
- **YouTube:** cole o link e clique em “Transcrever”. Além do download, a análise leva ~20–50 s numa música de 3–4 min; depois tudo fica em cache em `downloads/`. Se o PyMusicLooper já tiver baixado a música, o WAV dele é reaproveitado.
  - *Distribuição* escolhe como as notas vão para os motores: *Linhas dinâmicas* (padrão) ou *Papéis*. Ver a seção seguinte.
  - *Densidade de notas* (só nas linhas dinâmicas): quantas notas fracas a transcrição aceita. Mais densidade dá material aos motores extras.
  - *Motor de percussão* transforma o último motor em bumbo, caixa e chimbal.
  - *Vibrato e deslizes* (opcional, só nas linhas dinâmicas): cada nota segue a curva fina de afinação do transcritor, sem ficar presa a semitons.
  - *Volume por importância* (opcional, só nas linhas dinâmicas): as linhas extras tocam mais baixo, na proporção do valor delas, para não embolar a melodia com muitos motores.
  - *Áudio original* mistura a faixa real para comparar. Ela não passa pelos gráficos.
  - Adicionar ou remover motores refaz o arranjo na hora.
- **Modelo A × B:** “A · Ideal” toca senoides exatas na frequência da nota; “B · Mecânico” toca a simulação do motor. A troca é instantânea, no meio da música.
- **Andamento** acelera ou desacelera a partitura (e o áudio original, que muda de tom junto).
- **Editar partitura:** uma linha por motor. `A4` é uma nota de 1 tempo, `C#5:0.5` meio tempo, `-:2` pausa de 2 tempos, `@0.5` muda a duração padrão, `v0.6` muda a intensidade, `|` separa compassos (só visual), `#` no início da linha é comentário.

Para ver os limites do motor: baixe a *Velocidade máxima* para ~300 RPM e toque *Engrenagens*; as notas agudas da melodia não são alcançadas (gráfico 4 e cartão “Acima da vel. máx.”). Suba a *Inércia* para ~20× e as notas passam a deslizar. Ponha *Micropassos* em 1/32: o som fica mais suave, mas as notas agudas estouram o limite de pulsos do driver. Com *Intensidade da ressonância* 1 e *Amortecimento* 0,05, notas perto da *Frequência de ressonância* fazem o motor perder passos e o som tremer.

## Da música do YouTube aos motores

1. **Download** com yt-dlp e conversão para WAV com ffmpeg (`server.py`).
2. **Transcrição** com o [basic-pitch](https://github.com/spotify/basic-pitch) (Spotify), um modelo de transcrição polifônica que roda localmente via ONNX Runtime (`transcribe.py`). A saída da rede vira notas (início, fim, altura MIDI, intensidade, curva de afinação) em três densidades: os limiares de ataque/quadro 0,5/0,3 (normal, o padrão da biblioteca), 0,35/0,2 (média) e 0,25/0,15 (alta). O pacote é instalado com `--no-deps` porque pediria TensorFlow, que não existe para Python 3.13. Dois ajustes sobre a decodificação da biblioteca:
   - **Quebras falsas:** o basic-pitch corta notas contínuas em pedaços colados da mesma altura (67% das notas no gabarito sintético, que não tem nenhuma nota repetida colada). A força do ataque que a própria rede estima separa os casos: re-ataques reais ficam em 0,81–0,94, quebras falsas em 0,37–0,67. Pedaços com ataque abaixo de 0,7 são juntados (93% das quebras falsas, 4% dos re-ataques reais). Na gravação de tin whistle testada, a melodia passou de 705 pedaços para 152 notas.
   - **Curva de afinação:** o `get_pitch_bends` da biblioteca usa o pico do contorno (degraus de 1/3 de semitom) numa janela de ±8 semitons, que pega notas vizinhas. Aqui a curva é o centróide de 3 bins em volta do pico, numa janela de ±1,3 semitom, menos o desvio mediano da música. Esse desvio é sobretudo viés do modelo: +0,31 semitom em todas as notas do gabarito, que está afinado em Lá 440. No gabarito, a melodia com vibrato de ±0,3 semitom sai com curva em 100% das notas, e os instrumentos afinados retos ficam sem curva em 93–96%.
3. **Percussão** (`percussion.py`): separa o tonal do percussivo (HPSS na CQT) e transforma os picos do fluxo de energia por banda do componente percussivo em golpes de bumbo, caixa e chimbal.
4. **Distribuição** para N motores, no navegador (`arrangeMotors` em `score.mjs`).

### Linhas dinâmicas (padrão)

Nenhum motor tem papel fixo. O motor 1 recebe a cadeia de notas de maior valor na música inteira; essas notas saem da disputa, e o motor 2 recebe a melhor cadeia entre as que sobraram, e assim por diante (`dynamicLines`). O valor de uma cadeia é intensidade × tempo tocado, menos custos por salto maior que uma quinta e por interromper uma nota que ainda soaria; ela é achada por programação dinâmica sobre as notas. Consequências:

- todo ataque do motor é um ataque real da música, e uma nota interrompida nunca volta (sem vai-e-volta);
- quem é melodia, baixo ou acompanhamento sai da otimização, não de faixas de altura escolhidas à mão;
- cada motor extra pega o que sobrou de mais importante, então só fica parado se acabarem as notas (daí a *Densidade*);
- buracos de até 120 ms dentro de uma linha são preenchidos (a altura continua soando no áudio; o transcritor encerra notas cedo);
- nota repetida colada vira re-ataque: o motor segue girando e o volume dá uma piscada de 30 ms. Abrir um silêncio pararia o motor, e a reaceleração soa como um "vai e volta" na altura.

### Papéis

O primeiro arranjo: motor 1 = nota mais alta entre Mi3 e Fá♯6 (com bônus para a nota que acabou de atacar), último = nota mais grave até Sol3, os do meio = o resto. Fica para comparação.

### Como chegamos aqui

Teste com gabarito: a composição *Engrenagens* renderizada com timbres distintos (melodia com vibrato tipo voz, arpejo dedilhado, baixo, pad) e bateria por cima, 4 motores. Medidas: tempo em que algum motor toca a nota certa da melodia e do baixo, e F1 de notas (ataque ±50 ms, `mir_eval`).

| Distribuição | Melodia | Baixo | F1 |
|---|---|---|---|
| Picos da CQT por quadro (1ª versão) | 52% | 98%* | 0,38 |
| Papéis (basic-pitch) | 83% | 95% | 0,60 |
| NMF com dicionário de sons de motor (estilo [Let It Bee](https://github.com/ctralie/LetItBee)) | 11% | 85% | 0,35 |
| Soma de Fourier por resíduo (removida) | 78% | 96% | 0,33 |
| **Linhas dinâmicas, densidade média** | **85%** | **94%** | **0,57** |

\* tocava as notas graves, mas fora do motor do baixo e picotadas.

A *Soma de Fourier* tentava reproduzir o som somando os motores a cada instante: para o motor 1, um Viterbi escolhia a linha (altura ou silêncio a cada 23 ms) que mais explicava o espectro, com custo para trocar de nota; a contribuição era subtraída e o motor 2 trabalhava no resíduo. Era a mais parecida com o original no espectro médio, mas com poucos motores a soma segue *energia* (harmônicos, acordes de fundo) e não as *linhas* que o ouvido acompanha: soou ininteligível e saiu do app.

Em músicas reais (60 s, 6 motores, sem percussão), as linhas dinâmicas na densidade média ocupam os motores bem mais que os papéis (Toothless: 86/73/60/47/38/30% contra 65/14/12/15/11/53%), sem nenhum vai-e-volta de mais de uma quinta, e soam mais parecidas com o original (semelhança de espectro log 0,83–0,87 contra 0,77–0,79). O que aparece como quebra nelas é quase sempre re-ataque de nota repetida; silêncio entre notas diferentes fica em 2–3 por minuto por motor. Os scripts dessas medições ficaram em `~/tmp/claude/motor-orchestra/` (fora do projeto).

A percussão marca bem os golpes (no gabarito, acerta 84% dos golpes reais com F=0,67), mas ainda confunde as peças e pode sair densa demais; o checkbox a desliga.

## Matemática e física

### Síntese de Fourier e afinação

O som de cada motor é uma soma de senoides, $s(t)=\sum_n A_n\sin(2\pi f_n t+\phi_n)$, e o que sai da caixa de som é a superposição $S(t)=\sum_i s_i(t)$ (gráfico 2, lido no nó de soma antes do limitador). As notas usam afinação temperada, $f(n)=440\cdot 2^{(n-69)/12}$ com $n$ no padrão MIDI.

### Cadeia do modelo mecânico (`physics.mjs`)

    nota → passos/s desejados → pulsos do driver (× micropassos) → limites → dinâmica → ressonância → som

| Etapa | O que o código faz | Natureza |
|---|---|---|
| Nota → passos/s | A nota pede `f` passos completos por segundo | **Hipótese de projeto**, a mesma do Moppy: cada passo é um “tranco” de torque, então a taxa de passos vira o tom. Não é uma equivalência universal entre frequência elétrica e acústica. |
| Pulsos | `f_pulso = f · m` | **Físico**: com micropassos *m*, o driver precisa de *m* pulsos por passo completo. |
| RPM | $RPM = 60 f_{pulso}/(N_{passos}\cdot m)$; 440 pulsos/s, 200 passos, *m*=1 → 132 RPM | **Físico** (cinemática exata). |
| Limite do driver | pulsos acima de *Pulsos máx.* são cortados | **Físico** no conceito; o valor é configurável. |
| Velocidade máxima | passos/s limitados a `RPM_max · N / 60` | **Físico** no conceito; o motor real perde torque gradualmente com a velocidade (curva torque × velocidade), aqui é um corte seco. |
| Dinâmica | 1ª ordem com τ = *tempo de resposta* × *inércia*, e variação limitada pela aceleração máx. ÷ inércia (`a = T/J`) | **Aproximação**: um motor de passo real não é um sistema de 1ª ordem; o rotor oscila em torno de cada passo. |
| Ressonância | fator de amplificação de um oscilador amortecido, $1/\sqrt{(1-r^2)^2+(2\zeta r)^2}$, com $r=f/f_n$ | **Físico** como modelo do conjunto rotor/carcaça; o valor de $f_n$ é arbitrário. |
| Perda de passos | se `ressonância × amplificação > 2,5`, a velocidade cai aleatoriamente a cada passo de simulação | **Fenomenológico**: imita a instabilidade de meia faixa, sem modelar torque nem posição do rotor. |

Os estados do cartão vêm dessa cadeia: “Driver saturado”, “Acima da vel. máx.”, “Perdendo passos”, e “Acompanhando…” quando a velocidade está a mais de 3% da pedida.

### Som (`engine.mjs`)

- **Modelo A (ideal):** senoide exata na frequência da nota, sem dinâmica. Serve de referência.
- **Modelo B (mecânico):** um oscilador na **frequência simulada** (não na da nota) com forma de onda de “trancos”: harmônicos com amplitude $1/k^{p}$, $p = 0{,}75 + 0{,}32\log_2 m$ (passo completo = som áspero; micropasso = mais senoidal). Somam-se ruído em banda (atrito, rolamentos), um filtro ressonante na frequência natural (ganho e Q a partir de intensidade e ζ), um passa-baixa da carcaça e uma modulação de amplitude uma vez por volta (desbalanceamento do rotor). Motor quase parado quase não vibra (amplitude ∝ velocidade abaixo de 60 passos/s). A queda do som depende do amortecimento.
  Tudo isso é **fenomenológico**: o timbre foi ajustado para lembrar um motor de passo, não calculado de um modelo eletromecânico.
- **Agendamento:** a simulação roda a 250 Hz e calcula ~120 ms à frente do relógio do `AudioContext`; frequências e envelopes são agendados com `setValueAtTime`/`linearRampToValueAtTime`. O `setInterval` só decide quando calcular o próximo trecho; nenhuma amostra é gerada por ele. Mudanças (nota, parâmetro, play/stop) descartam o que estava agendado e refazem a simulação a partir de agora, com ~15 ms de latência.

### Gráficos

1. **Ondas individuais:** `AnalyserNode` na saída de cada motor.
2. **Superposição:** `AnalyserNode` no nó de soma, com as parcelas ao fundo.
3. **Espectro:** FFT de 8192 pontos do mesmo nó de soma, em escala log, com as notas comandadas tracejadas. Com motores saturados, os picos aparecem longe das linhas.
4. **Dinâmica:** passos/s comandados (tracejado) × simulados (cheio), do histórico da simulação, com os limites de velocidade e do driver e a faixa de ressonância.

## Limitações conhecidas

- O modelo não tem torque, corrente, posição do rotor nem carga real; não serve para dimensionar motor ou driver, só para ouvir e comparar tendências.
- A relação nota ↔ taxa de passos é uma escolha (a do Moppy), não uma lei: o som real de um motor depende da montagem, da carcaça e do driver.
- A transcrição erra notas, oitavas e fins de nota; músicas com voz e bateria marcadas funcionam melhor que orquestrais ou muito densas. Densidade alta traz mais notas falsas junto com as fracas verdadeiras.
- O vibrato segue só em parte: na gravação de tin whistle, a opção baixa o erro de afinação mediano de 25 para 17 cents, mas o movimento fino tem correlação de só ~0,2 com a afinação real (pYIN). O contorno da rede é grosseiro para vibrato rápido (cru, sem suavização, chega a ~0,4). A afinação geral da gravação (ex.: +15 cents nesse apito) é descontada junto com o viés do modelo.
- A percussão detecta bem *quando* há golpe, mas separa mal bumbo, caixa e chimbal.
- O *Andamento* muda o tom do áudio original (não há *time-stretch*).

## Estrutura

| Arquivo | Papel |
|---|---|
| `server.py` | servidor local: download, cache e API |
| `transcribe.py` | transcrição com basic-pitch (ONNX), em três densidades |
| `percussion.py` | golpes de percussão (HPSS + fluxo por banda) |
| `score.mjs` | afinação, partitura em texto, demonstrações, as duas distribuições e a percussão |
| `physics.mjs` | modelo mecânico do motor (função pura) |
| `engine.mjs` | Web Audio: síntese, agendamento, transporte |
| `charts.mjs` | gráficos e rolo de notas |
| `app.mjs`, `index.html`, `style.css` | interface |

## Verificação

    node --test tests/orchestra.test.mjs

Cobre afinação, RPM, saturação de velocidade e de driver, inércia, perda de passos, partituras, as linhas dinâmicas (cadeias por motor, legato, repetição), a percussão e o arranjo por papéis.

Use áudio que você tem direito de baixar e ouvir.
