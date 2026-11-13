# Resultados locais da pesquisa de melodia — 12/11/2026

**Continuação experimental:** [PESQUISA_HARMONICA.md](PESQUISA_HARMONICA.md) confirma o mecanismo do limiar de 70%, testa um protótipo contínuo em 34 faixas, compara dois estimadores polifônicos e registra controles adversários e um piloto espectral. O protótipo corrige os quatro pontos investigados de MEGALOVANIA, mas apresenta regressões e permanece fora do aplicativo. As conclusões abaixo descrevem a primeira fase.

**A primeira hipótese do relatório foi testada: o guia MELODIA, nas configurações ensaiadas, não resolveu os quatro conflitos MIDI 55 × 74 do começo de MEGALOVANIA.** Aumentar a concordância do arranjo com esse guia também não demonstrou melhor fidelidade musical.

Essa é uma conclusão negativa sobre uma integração simples, não uma refutação do MELODIA ou de todo o roteiro de pesquisa. Os experimentos são isolados; o guia não foi integrado ao aplicativo. O próximo passo mais fundamentado é investigar evidência de fundamentais e independência harmônica, com referência alinhada para distinguir seleção e transcrição.

## 1. Escopo e integridade

[deep-research-report.md](deep-research-report.md) foi lido por inteiro. A recomendação de preservar mapas e testar um guia antes de desenvolver uma solução maior orientou este piloto.

Run local: `downloads/research/20261112T164100.748825Z/`.

Foram preservados código, os dois WAVs, JSON de candidatos, diferenças Git, versões, modelo e hashes. O baseline é a versão experimental atual do arranjador descrita no dossiê, não o antigo commit inicial.

As novas inferências de densidade alta reproduziram **exatamente** início, fim, MIDI e intensidade dos 2359 candidatos de MEGALOVANIA e 3850 de ASGORE. Não foi alterada a transcrição usada na comparação dos arranjos.

Os mapas `note`, `onset` e `contour` foram salvos antes da decodificação em `basic-pitch-raw.npz`, com o vetor de tempos. ASGORE usa a entrada compensada em −38 cents e escala de tempo 1,0221768707482992; MEGALOVANIA usa escala 1.

Os tempos do guia **também** voltam à escala original. Suas frequências permanecem na afinação normalizada da análise para corresponder ao MIDI dos candidatos. Corrigir apenas o relógio do Basic Pitch, esquecendo o do guia, deslocaria progressivamente a comparação de ASGORE.

## 2. Fontes primárias conferidas e ressalvas

- A [documentação do MELODIA](https://essentia.upf.edu/reference/std_PredominantPitchMelodia.html) confirma F0/confiança, recomenda EqualLoudness e distingue ausência de melodia de contornos não salientes recuperados por `guessUnvoiced`.
- A [documentação de EqualLoudness](https://essentia.upf.edu/reference/std_EqualLoudness.html) lista taxas suportadas; **22050 Hz não é uma delas**. O guia foi executado em 44100 Hz, não diretamente na taxa usada pela rede.
- O [código de PitchContoursMelody](https://github.com/MTG/essentia/blob/master/src/algorithms/tonal/pitchcontoursmelody.cpp) calcula confiança pela saliência do contorno. Hipóteses não salientes recuperadas recebem confiança negativa.
- O [repositório do Basic Pitch](https://github.com/spotify/basic-pitch) documenta outputs intermediários e observa que o modelo funciona melhor com um instrumento de cada vez. Há evidência anterior ao MIDI que pode ser inspecionada.
- A [página de licenciamento da Essentia](https://essentia.upf.edu/licensing_information.html) é relevante caso se decida distribuí-la com o projeto. A instalação atual foi separada para pesquisa, sem adicionar dependência ao app.

O relatório recebido usa tokens internos de citação, sem bibliografia de URLs recuperável no arquivo. Nem todos os artigos puderam ser identificados por esses tokens. As fontes acima foram verificadas diretamente; as demais comparações continuam sendo revisão recebida, não validação local nossa.

Suporte do Basic Pitch, saliência do guia e intensidade de evento não são probabilidades intercambiáveis. A arquitetura “PHR” é uma proposta, não um algoritmo já validado. Interações entre hipóteses e recompensas por frases também precisam ser formalizadas antes de assumir que tudo cabe em fluxo de custo mínimo aditivo.

## 3. Configuração e tempos

CPU Intel Core i7-9750H, 12 CPUs lógicas; Python 3.13; Basic Pitch 0.4.0; librosa 0.11.0; numpy 2.5.3; ONNX Runtime 1.31.1. Wheel experimental `essentia==2.1b6.dev1389`, API `2.1-beta6-dev`.

MELODIA: EqualLoudness, 44100 Hz, frame 2048, hop 128, mínimo 80 Hz, máximo 2000 Hz, `guessUnvoiced=false`. Demais parâmetros nos padrões da biblioteca. Portanto, é a configuração padrão com faixa superior específica, não absolutamente todos os defaults.

Uma passagem por música, mesma instância ONNX reutilizada. **Não** é um benchmark com cinco repetições quentes e partida fria controlada. Pico RSS é cumulativo do processo Linux, não memória adicional exclusiva do guia.


| Faixa | Áudio (s) | Afinação (s) | BP (s) | Decode alta (s) | MELODIA (s) | Pico RSS (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
| 0FCvzsVlXpQ | 156.000 | 1.317 | 2.429 | 4.079 | 12.739 | 564.2 |
| PJ1yqbr8Y50 | 173.186 | 0.421 | 2.495 | 5.245 | 12.980 | 656.4 |



Confiança observada: de 0 a aproximadamente 0,129 em MEGALOVANIA e de 0 a 0,106 em ASGORE. Um corte arbitrário de “confiança ≥0,5” teria descartado todo o guia. No ensaio principal, quadro elegível significa F0 >0 e confiança >0.

## 4. Resultado nos conflitos de MEGALOVANIA

Os intervalos abaixo são os da candidata MIDI 74, próxima do terceiro harmônico da candidata MIDI 55. Ainda não há anotação humana alinhada para confirmar todos os eventos como referência definitiva.


| Intervalo (s) | Quadros | Guia elegível | MIDI 55 | MIDI 74 |
| --- | --- | --- | --- | --- |
| 1.126–1.265 | 48 | 0 | 0 | 0 |
| 3.124–3.264 | 48 | 0 | 0 | 0 |
| 5.134–5.285 | 52 | 0 | 0 | 0 |
| 7.132–7.283 | 52 | 0 | 0 | 0 |



O guia não votou nem em 55 nem em 74 nesses intervalos. Logo, não forneceu evidência para corrigir esses pontos.

Foram testadas três ablações adicionais em cada música:

1. `guessUnvoiced=true`, mantendo os demais parâmetros.
2. `voicingTolerance=1.0`, mantendo o guia sem hipóteses negativas.
3. Análise apenas do prefixo de 16 segundos, com o mesmo filtro e parâmetros testados.

**Nenhuma retornou F0 nos quatro intervalos-alvo de MEGALOVANIA**, mesmo ao examinar as hipóteses de confiança negativa. O recorte alterou escolhas em outros pontos, mas não resolveu esses casos. Algumas variantes retornaram 72, 65 ou 67 em outros pontos do riff, compatíveis com hipóteses de parciais/oitavas do diagnóstico anterior.

Isso reduz a plausibilidade de resolver o caso apenas relaxando o filtro final de vozeamento ou encurtando o contexto. Não investiga todos os parâmetros, outros modelos multi-F0 ou separação de fontes. O diagnóstico seguinte procurou evidência anterior à saída final.

### 4.1 A informação está presente antes da decisão final

Foram inspecionados os mapas brutos do Basic Pitch nos mesmos intervalos e reconstruída a saliência espectral por quadro seguindo os parâmetros do [front-end C++ oficial](https://github.com/MTG/essentia/blob/master/src/algorithms/tonal/predominantpitchmelodia.cpp). Essa reconstrução diagnóstica não é instrumentação dos estados internos nem prova de equivalência bit a bit do algoritmo completo.


| Intervalo (s) | BP nota 55 | BP nota 74 | Ataque 55 | Ataque 74 | Quadros com saliência 55 >74 |
| --- | --- | --- | --- | --- | --- |
| 1.126–1.265 | 0.557 | 0.189 | 0.822 | 0.526 | 68.75% |
| 3.124–3.264 | 0.540 | 0.187 | 0.822 | 0.526 | 68.75% |
| 5.134–5.285 | 0.533 | 0.207 | 0.798 | 0.559 | 69.23% |
| 7.132–7.283 | 0.532 | 0.208 | 0.798 | 0.559 | 69.23% |


As médias de nota acima usam o intervalo comum do candidato 74, não necessariamente toda a duração do candidato 55. Portanto, diferem da intensidade média do evento no cache. Os picos de ataque são medidos em ±60 ms do início de cada intervalo.

Nos quatro casos, a rede oferece maior suporte de nota e ataque a 55. Na reconstrução de saliência, 55 supera 74 em aproximadamente 69% dos quadros; as médias de saliência dos dois ficam próximas. Outros quadros favorecem aproximadamente 67, uma oitava acima de 55, ou 74. Isso mostra evidência disputada e flutuante, não ausência completa de informação acústica.

**Inferência de pesquisa:** preservar múltiplas hipóteses e combinar o suporte da rede com relações entre parciais e continuidade de trajetória parece mais promissor que usar apenas o F0 final do MELODIA. Ainda não se estabeleceu qual estágio interno descarta cada hipótese nem se esses indicadores generalizam para uma melodia aguda independente. A confirmação musical exige referência alinhada.

Dados por quadro, parâmetros e mapas resumidos estão em [research/harmonic-diagnostics-2026-11-12.json](research/harmonic-diagnostics-2026-11-12.json).

## 5. Ablação da prioridade em candidatos congelados

Configuração: quatro motores totais, com percussão; redução melódica, densidade alta, filtro 0,15, harmonia/voicing/dobramento ligados. Só a primeira voz da cópia do arranjador recebe uma pontuação auxiliar. Não há novos candidatos ou novos ataques.

Para cada evento, suporte significa a fração de quadros concordantes com seu MIDI, arredondando F0 ao semitom mais próximo:

```text
prioridade = (1 − alpha × fração_elegível) × prioridade_original
             + alpha × 4 × fração_concordante
```

O fator 4 e os alphas são pesos exploratórios sem calibração. Onde não há guia, permanece a prioridade original. O guia não é referência de verdade.


| Faixa | alpha | Ocupação voz 1 | Pausas >150 ms | Soma pausas (s) | Concordância quando ambos ativos |
| --- | --- | --- | --- | --- | --- |
| 0FCvzsVlXpQ | 0 | 78.70% | 71 | 27.255 | 54.64% |
| 0FCvzsVlXpQ | 0.25 | 77.59% | 76 | 29.114 | 56.53% |
| 0FCvzsVlXpQ | 0.5 | 74.33% | 86 | 34.585 | 65.95% |
| 0FCvzsVlXpQ | 1 | 71.40% | 91 | 39.730 | 74.17% |
| PJ1yqbr8Y50 | 0 | 87.47% | 53 | 15.513 | 28.86% |
| PJ1yqbr8Y50 | 0.25 | 87.61% | 53 | 15.240 | 30.88% |
| PJ1yqbr8Y50 | 0.5 | 88.59% | 47 | 12.875 | 32.25% |
| PJ1yqbr8Y50 | 1 | 83.53% | 62 | 23.451 | 52.89% |



A concordância aumenta em parte porque é recompensada pela própria função objetivo: **não é validação independente**. Em MEGALOVANIA, alpha=1 aumenta as pausas de 71 para 91 e reduz a ocupação, sem corrigir os quatro conflitos. Esses indicadores auxiliares também não medem fidelidade isoladamente.

Em ASGORE, alpha=0,5 reduz algumas pausas, sem comprovar que a linha resultante seja o tema. Alpha=1 favorece outras linhas, incluindo graves. Não escolhemos uma configuração para o app com base nessas contagens.

Os JSON contêm comparações separadas com hipóteses negativas e prefixos. Quando `--include-guessed` está ativo, os campos históricos chamados `guideVoiced...` significam quadros **elegíveis ao ensaio**, incluindo hipóteses negativas, e não somente decisão positiva de vozeamento da biblioteca.

## 6. Controles sintéticos com referência gerada

Foram gerados seis controles determinísticos a 44100 Hz, com notas e stems conhecidos. São um piloto pequeno, não um conjunto representativo de músicas.

RPA considera ±50 cents; silêncio previsto conta como erro quando havia nota. RCA ignora oitavas. A métrica central exclui 50 ms de cada borda e é auxiliar: notas de 100 ms praticamente não contribuem a ela. Não se calculou F1 de ataques a partir desses contornos.


| Controle | RPA | RCA | RPA central | Recall vozeamento | Falso alarme |
| --- | --- | --- | --- | --- | --- |
| pure-tone | 74.02% | 74.02% | 75.14% | 74.02% | 0.00% |
| rich-harmonics | 74.02% | 74.02% | 75.14% | 74.02% | 0.00% |
| weak-fundamental | 74.02% | 74.02% | 74.95% | 74.02% | 0.00% |
| missing-fundamental | 74.02% | 74.02% | 74.95% | 74.02% | 0.00% |
| fast-repeated-attacks | 54.39% | 54.39% | 73.26% | 54.39% | 0.30% |
| high-melody-over-bass | 0.00% | 0.00% | 0.00% | 98.84% | 42.39% |



Nos quatro primeiros controles, a referência é MIDI 55,57,53,55, com 0,5 s por nota e pausas de 0,1 s. O controle de fundamental ausente usa apenas parciais 2,3,4,6. Há reconhecimento da fundamental em parte do tempo, mas nem toda nota é classificada como melódica.

O último caso tem uma melodia designada como alvo, em 74,76,72,74, sobre baixo MIDI 43 mais forte e contínuo. O alvo não foi recuperado pela configuração testada. O papel melódico veio da geração dos stems, não de outro estimador; portanto, o controle contradiz a adoção desse guia como autoridade única para uma melodia mais suave. Não afirma que qualquer preferência perceptiva humana esteja determinada pelo papel atribuído na síntese.

Referências, parciais, amplitudes, envelopes, WAVs misturados, stems e arrays previstos foram preservados no run.

## 7. Decisão e próximo experimento

**Não promover a integração simples do MELODIA ao app neste estágio.** Ele continua útil como baseline ou fonte opcional de evidência, sem virar gabarito automático. Também não há base para substituir o Basic Pitch ou anunciar um algoritmo novo como validado.

O resultado favorece a investigação de evidência polifônica e independência harmônica:

1. Anotar e revisar contra a gravação exata os quatro conflitos e 20–30 s do riff: alturas, ataques, offsets e incerteza. Não promover pYIN/MELODIA a referência automática.
2. Expandir a inspeção já feita nos quatro conflitos para famílias de parciais, envelopes e modulação de altura ao longo das frases, preservando alternativas em vez de reduzir tudo a um F0 por quadro.
3. Testar independência por ataques e trajetórias com casos adversários de oitavas/quintas verdadeiras e fundamental ausente. Não excluir por intervalo MIDI sozinho.
4. Medir candidatos disponíveis versus primeira voz e qualquer voz contra a referência; decidir então entre seleção de trajetórias e frente acústica.
5. Reservar outras músicas e medir precisão, recall, ataques, falsas sustentações e escuta controlada.

A anotação real de referência ainda não foi produzida. Os seis controles sintéticos não eliminam essa limitação.

## 8. Reprodução e artefatos

- [scripts/research-melody.py](scripts/research-melody.py): snapshot, cópia dos dados, mapas brutos, guia e tempos.
- [scripts/research-melody-guide.mjs](scripts/research-melody-guide.mjs): pontuação experimental em cópia do módulo congelado.
- [scripts/research-melodia-variants.py](scripts/research-melodia-variants.py): contexto e vozeamento.
- [scripts/research-melodia-controls.py](scripts/research-melodia-controls.py): referências sintéticas, stems e avaliação de F0.
- [scripts/research-harmonic-diagnostics.py](scripts/research-harmonic-diagnostics.py): mapas e saliência por quadro nos quatro conflitos 55/74.
- [research/results-2026-11-12.json](research/results-2026-11-12.json): resumo portátil com parâmetros, hashes e resultados completos.
- [research/harmonic-diagnostics-2026-11-12.json](research/harmonic-diagnostics-2026-11-12.json): evidência anterior à seleção final.

Instalação experimental isolada, sem alterar `requirements.txt`:

```bash
uv pip install --python .venv/bin/python --target /tmp/motor-orchestra-essentia --no-deps essentia==2.1b6.dev1389
./run.sh scripts/research-melody.py --essentia-path /tmp/motor-orchestra-essentia
```

O primeiro script imprime o caminho do novo run. Use-o nos comandos seguintes:

```bash
./run.sh scripts/research-melodia-variants.py downloads/research/20261112T164100.748825Z --essentia-path /tmp/motor-orchestra-essentia
node scripts/research-melody-guide.mjs downloads/research/20261112T164100.748825Z
node scripts/research-melody-guide.mjs downloads/research/20261112T164100.748825Z melodia-guess-unvoiced.json --include-guessed
./run.sh scripts/research-melodia-controls.py downloads/research/20261112T164100.748825Z --essentia-path /tmp/motor-orchestra-essentia
./run.sh scripts/research-harmonic-diagnostics.py downloads/research/20261112T164100.748825Z --essentia-path /tmp/motor-orchestra-essentia
```

Os caminhos identificam o run já realizado. Variantes e controles recusam sobrescrever seus resultados: ao repetir, substitua pelo caminho do novo run.

WAVs, mapas e snapshots extensos ficam em `downloads/`, ignorado pelo Git. O JSON portátil mantém resultados e hashes, mas não reconstrói os áudios. Para transferir a pesquisa, envie também os artefatos necessários ou preserve-os em armazenamento de avaliação.

Verificação: candidatos idênticos ao cache; ataques vindos dos candidatos, salvo percussão/dobramentos identificados; ausência de sobreposição por voz nos arranjos comparados; scripts verificados sintaticamente; 65 testes JavaScript aprovados. Isso verifica condições e invariantes, não acerto musical.
