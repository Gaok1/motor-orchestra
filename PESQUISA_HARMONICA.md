# Independência harmônica: experimentos locais e validação ampliada

Data: 12/11/2026. Continuação de [PESQUISA_RESULTADOS.md](PESQUISA_RESULTADOS.md), após a nova revisão fornecida na conversa.

**O mecanismo dos 70% foi confirmado em execução. Um protótipo contínuo corrige os quatro conflitos investigados de MEGALOVANIA, mas regride em controles com melodia aguda suave. Não foi incorporado ao aplicativo.**

Também foram executados MultiPitchMelodia, MultiPitchKlapuri, 12 controles acústicos, 144 cenários simbólicos e um piloto de comparação espectral entre uma e duas componentes. A pesquisa agora tem resultados locais, inclusive negativos, para avaliar as propostas.

## 1. O que foi congelado e o que os testes permitem concluir

- Arranjador, configuração experimental e candidatos das 34 faixas congelados em `downloads/research/harmonic-1794505637554/`.
- Dois casos de desenvolvimento: MEGALOVANIA e ASGORE. Bonetrousle separado como faixa da mesma franquia. Outras 31 faixas, agrupadas em 29 obras/grupos para não contar duas versões de Gravity Falls e Xote da Alegria como obras independentes.
- Essas faixas adicionais já existiam no cache; algumas participaram de etapas históricas do projeto. São **validação exploratória adicional**, não um conjunto externo inédito ou uma avaliação cega.
- Os caches têm versões de análise 8–10. Cada comparação usa exatamente o mesmo JSON para os dois arranjadores; não se compara uma transcrição nova com uma antiga.
- Configuração contínua `continuous-v1` registrada antes de inspecionar os resultados das faixas adicionais e mantida sem ajuste posterior.
- Cinco orçamentos: 1, 3, 4, 6 e 12 motores. Densidade alta, intensidade mínima 0,15, percussão/harmonia/condução/dobramento ligados, bends/mix desligados. A percussão reserva o último motor quando aplicável.
- Os WAVs e mapas da primeira fase foram reutilizados nos testes acústicos. ASGORE conserva compensação de −38 cents e escala de tempo 1,0221768707482992; as frequências dos estimadores ficam na afinação normalizada e os tempos voltam à gravação original.

Não há gabarito humano alinhado das músicas reais. Ocupação, quantidade de pausas, registro e mudanças de seleção são medidas descritivas; **não medem fidelidade melódica**. Os controles gerados têm referência conhecida, mas não representam a diversidade de gravações reais.

## 2. Confirmação do defeito localizado

Foi instrumentada uma cópia do arranjador, registrando cobertura, vizinhos e resultado do teste booleano. A análise não ficou apenas na leitura do código.

| Candidata 74, início | Vizinha anterior relevante | Cobertura da vizinha | Resultado do teste ≥70% | `independent` da relação 74/55 |
| --- | --- | --- | --- | --- |
| 1,126 s | 72 | 80,17% | passa | falso |
| 3,124 s | 72 | 100% | passa | falso |
| 5,134 s | 75 em 4,879–5,018 s | 66,906% | falha | verdadeiro |
| 7,132 s | 75 em 6,877–7,016 s | 66,906% | falha | verdadeiro |

Nos dois últimos ciclos, `parallel` também é verdadeiro. O único vizinho que falha no pareamento faz `neighbors.some(neighbor => !paired(neighbor))` marcar independência. A proteção impede a penalização dessa hipótese aguda, apesar do suporte forte à fundamental.

Isso confirma o mecanismo de decisão observado, não uma prova automática de qual instrumento produziu cada parcial no áudio.

Rastro completo e configuração: [harmonic-phase2-summary-2026-11-12.json](research/harmonic-phase2-summary-2026-11-12.json).

## 3. Protótipo contínuo e resultado de desenvolvimento

[continuous-harmonics.mjs](research/continuous-harmonics.mjs) combina cobertura temporal, diferença entre ataques por uma função gaussiana, força relativa e evidência média dos vizinhos. Um vizinho marginal deixa de vetar sozinho toda a família. Nenhuma candidata é removida; apenas sua prioridade muda na cópia experimental do arranjador.

É uma nova heurística experimental, não uma probabilidade calibrada de independência. Conserva escalas da heurística anterior: 60 ms para ataques, penalidades 0,85 para oitavas e 0,97 para outros parciais; a transição de força substitui o antigo corte relativo de intensidade. Não troca 70% por 65%.

| Medida, quatro motores | Baseline | Contínuo v1 |
| --- | --- | --- |
| MEGALOVANIA: MIDI da primeira voz em 1,2 / 3,2 / 5,2 / 7,2 s | 55 / 55 / 74 / 74 | 55 / 55 / 55 / 55 |
| MEGALOVANIA: ocupação da primeira voz | 78,704% | 80,753% |
| MEGALOVANIA: pausas internas >150 ms | 71 | 71 |
| ASGORE: ocupação da primeira voz | 87,470% | 87,107% |
| ASGORE: pausas internas >150 ms | 53 | 55 |

Os 65 testes existentes passam tanto com o arranjador atual quanto com a cópia experimental. Isso, sozinho, foi insuficiente: os controles adicionais abaixo encontram regressões.

## 4. Outras músicas: 340 arranjos e resultados mistos

Foram executados 34 × 5 × 2 = **340 arranjos**, formando 170 comparações. Todos passaram nas verificações de eventos finitos, duração positiva, ausência de sobreposição dentro de uma voz e origem dos ataques nos candidatos, com as exceções explícitas do arranjador para percussão e dobramentos.

Entre as faixas adicionais estão Test Drive, DBZ Budokai 3, Wuthering Heights, Rondo Alla Turca, Never Gonna Give You Up, Freezing Moon, Stairway to Heaven, Carry On, tin whistle, shanties e forró. O inventário completo está no protocolo do JSON de validação.

| Faixa, quatro motores | Tempo em que a primeira voz mudou | Δ ocupação, pontos percentuais | Δ pausas >150 ms |
| --- | --- | --- | --- |
| Test Drive | 1,434% | −0,372 | +1 |
| DBZ Budokai 3 | 2,160% | −0,101 | +1 |
| Rondo Alla Turca | 2,498% | −0,122 | 0 |
| Wuthering Heights | 5,602% | −0,134 | +2 |
| Celtic Hymn, tin whistle | 6,820% | −0,182 | −1 |
| Never Gonna Give You Up | 11,075% | +1,581 | −5 |

Nas 31 faixas adicionais, 13 tiveram menos pausas, 15 tiveram mais e 3 ficaram iguais. Fazendo média por obra/grupo, a alteração da primeira voz ocupa 5,477% do tempo; a ocupação muda −0,028 ponto percentual e a quantidade de pausas muda +0,121 por grupo. Isso **não demonstra melhoria geral**.

A primeira voz é selecionada antes das demais e permanece igual entre os cinco orçamentos neste ensaio. Esses cinco resultados não são cinco confirmações independentes da qualidade da melodia. Os demais motores foram verificados estruturalmente; não há gabarito para medir sua fidelidade.

Dados: [harmonic-validation-2026-11-12.json](research/harmonic-validation-2026-11-12.json).

## 5. Controles simbólicos: motivo para rejeitar a promoção do v1

Foram gerados 144 cenários, com semente fixa, transposições, quatro durações, variações de intensidade e de início/fim. São variantes correlacionadas de quatro famílias, não 144 obras independentes. Cada cenário foi arranjado com 1, 2 e 4 vozes, pelos dois algoritmos.

| Família, 36 cenários cada | Cobertura temporal do tema na voz 1: baseline | Contínuo v1 |
| --- | --- | --- |
| Cópias harmônicas com ataques antecipados e duração reduzida | 1,04% | 1,39% |
| Melodia aguda suave sobre acordes mais fortes | 95,14% | 86,81% |
| Voz aguda com ataques diferentes e trajetória divergente | 100% | 100% |
| Duas vozes reais paralelas e sincronizadas | sem rótulo único de tema | sem rótulo único de tema |

Na família de melodia aguda suave, os cenários 1, 13 e 25 regridem; são variantes relacionadas. Na família de cópias harmônicas, **ambos os algoritmos falham amplamente**. Corrigir o caso específico de MEGALOVANIA não resolveu o comportamento geral sob variação temporal.

Com duas vozes, as duas linhas das famílias divergente e paralela permanecem cobertas em 100% nestes controles. Cobertura não penaliza notas extras e não substitui precisão. A família de sombras mede seleção a partir de candidatos fornecidos, não capacidade de reconhecer fontes no áudio.

Dados e referências de cada cenário: [harmonic-symbolic-2026-11-12.json](research/harmonic-symbolic-2026-11-12.json).

## 6. MultiPitchMelodia e MultiPitchKlapuri foram executados

A documentação confirma que [MultiPitchMelodia](https://essentia.upf.edu/reference/std_MultiPitchMelodia.html) fornece vários contornos e que [MultiPitchKlapuri](https://essentia.upf.edu/reference/std_MultiPitchKlapuri.html) estima conjuntos de alturas por soma harmônica e seleção conjunta. Isso justifica testá-los como evidência adicional, sem escolher prematuramente uma única F0.

Execução isolada da mesma Essentia da fase anterior: 44100 Hz, frame 2048, hop 128, faixa 80–2000 Hz e demais parâmetros padrão. EqualLoudness aplicado aos dois. O Basic Pitch usa sua própria entrada, sem esse filtro, e a decodificação alta atual (0,25/0,15). Portanto, é uma comparação de pipelines concretos, não uma ablação de redes com pré-processamento idêntico.

### 6.1 Um detalhe de relógio que precisou ser corrigido

No [fonte de MultiPitchKlapuri](https://github.com/MTG/essentia/blob/v2.1_beta5-1555-g33108c70/src/algorithms/tonal/multipitchklapuri.cpp), quadros sem picos fazem `continue` antes de adicionar a saída. O comprimento retornado pode ser menor que a grade temporal original. Isso foi observado na instalação usada: no controle rápido, 932 quadros de entrada e 814 saídas.

Foi reconstituída a presença de picos com o mesmo front-end: corte centrado, Hann, padding 4×, picos espectrais e saliência. Para **cada controle e música**, a quantidade de quadros com picos foi verificada contra a quantidade efetivamente retornada pela biblioteca. Quadros vazios foram reinseridos antes das métricas.

MEGALOVANIA tinha 461 quadros omitidos; ASGORE, 520. Os dados apresentados aqui já estão corrigidos. O resultado inicial desalinhado foi preservado apenas para auditoria como `obsolete-unaligned-results.json` no run local e não deve ser utilizado.

### 6.2 Quatro conflitos de MEGALOVANIA

| Janela | Quadros | MultiPitchMelodia: 55 / 74 | Klapuri: 55 / 74 |
| --- | --- | --- | --- |
| 1,126–1,265 s | 48 | 0 / 0 | 48 / 35 |
| 3,124–3,264 s | 48 | 0 / 0 | 48 / 35 |
| 5,134–5,285 s | 52 | 0 / 0 | 48 / 37 |
| 7,132–7,283 s | 52 | 0 / 0 | 48 / 36 |

Klapuri oferece evidência para a candidata grave que faltava no MELODIA. **Não resolve a independência:** também retorna a candidata aguda em grande parte dos quadros. Não seria correto convertê-lo diretamente em veto aos eventos do Basic Pitch.

As duas músicas foram analisadas inteiras. Tempos de uma passagem, sem benchmark estatístico:

| Faixa | MultiPitchMelodia | Klapuri nativo | Reconstrução adicional do relógio |
| --- | --- | --- | --- |
| MEGALOVANIA, 156 s | 9,82 s | 42,34 s | 8,07 s |
| ASGORE, 173,19 s | 10,05 s | 44,34 s | 9,62 s |

Os conjuntos completos de alturas foram preservados nos JSONs do run. ASGORE ainda não tem anotações alinhadas para avaliar acurácia.

### 6.3 Controles acústicos com referência conhecida

Reutilizados os seis controles anteriores e adicionados A–F. Métricas de altura por quadro, com tolerância de 50 cents e associação um a um para precisão/recall dos conjuntos. A tabela mostra **recall da linha designada**, não F1 de eventos, qualidade do arranjo ou precisão de todas as notas.

| Controle | Basic Pitch | MultiPitchMelodia | Klapuri, alinhado |
| --- | --- | --- | --- |
| Senoide simples | 89,1% | 98,5% | 100% |
| Harmônicos ricos | 95,5% | 98,5% | 100% |
| Fundamental fraca | 98,8% | 98,7% | 100% |
| Fundamental ausente | 0% | 98,7% | 100% |
| Ataques rápidos/repetidos | 94,9% | 77,4% | 100% |
| Melodia aguda suave sobre baixo, controle anterior | 99,9% | 0% | 23,4% |
| A: Sol3 com terceiro harmônico forte | 100% | 98,9% | 100% |
| B: Sol3 + Ré5 com modulações diferentes | 100% | 0% | 0% |
| C: Sol3 + Ré5 com ataques diferentes | 100% | 0% | 51,2% |
| E: Sol3 sem fundamental | 0% | 98,9% | 100% |
| F: melodia aguda suave sobre Sol3 forte | 100% | 0% | 0% |

No controle B/C, a linha designada para essa métrica é a aguda; a referência polifônica inclui ambas. O controle D é excluído dessa comparação de decisão única por sua ambiguidade física.

Recall alto pode acompanhar muitos falsos positivos: a precisão de conjuntos do Klapuri no controle de senoide é 43,8%; a do Basic Pitch em A é 19,7%. As métricas completas estão no JSON. Estes controles favorecem timbres sintéticos específicos e não estimam desempenho médio em gravações reais.

O resultado é complementar: os estimadores recuperam a fundamental ausente nos controles em que a decodificação do Basic Pitch não a fornece, enquanto o Basic Pitch preserva melodias agudas que os dois deixam escapar. Uma fusão precisa **acrescentar evidência**, sem exigir concordância entre todos os modelos.

Dados: [multipitch-2026-11-12.json](research/multipitch-2026-11-12.json).

## 7. Piloto espectral H0 × H1

Foi implementado um experimento pequeno inspirado pela pergunta de reconstrução conjunta, **sem reproduzir os algoritmos publicados**. O [artigo de Klapuri](https://www.ee.columbia.edu/~dpwe/papers/Klap06-multif0.pdf) descreve estratégias de soma/cancelamento e estimação conjunta. [Benetos e Dixon](https://openaccess.city.ac.uk/id/eprint/2049/) tratam combinações de alturas, parciais sobrepostos e envelopes espectrais. Esses trabalhos motivam a investigação; os resultados deles não validam o código novo.

O piloto extrai amplitudes em bandas dos 12 primeiros parciais de uma fundamental candidata. STFT Hann de 4096 amostras, hop 256, 44100 Hz. Compara:

- H0: um envelope espectral estável multiplicado por um envelope temporal comum.
- H1: H0 mais uma componente com outro envelope temporal nas bandas 3, 6, 9 e 12.

Fatores não negativos, 500 iterações e quatro reinícios fixos. H0 permanece como solução possível de H1 com a segunda componente zerada. O ganho é a redução do erro quadrático, normalizada pela norma quadrática da **matriz dessas bandas**, não pela energia de todo o áudio.

Não há limiar calibrado, probabilidade de independência ou penalidade de complexidade validada. H1 tem mais liberdade e pode ajustar ruído ou mudanças de timbre. A fundamental 55 é fornecida como hipótese neste piloto; ele não encontra automaticamente todas as fundamentais.

| Controle | Ganho de H1 como % da norma quadrática da matriz |
| --- | --- |
| A: uma fonte, terceiro harmônico forte | 0% |
| B: duas fontes com modulações diferentes | 1,8196% |
| C: duas fontes com ataques diferentes | 8,4197% |
| D: duas fontes observacionalmente equivalentes a uma | 0,00000044% |
| E: fundamental ausente | 0% |
| F: melodia aguda suave | 0,3921% |
| MEGALOVANIA, quatro janelas | 0,4314–0,4932% |

O modelo distingue os controles claros de ataque/modulação do controle de uma fonte, mas **não demonstrou resolver MEGALOVANIA**. O ganho das janelas reais tem a mesma ordem de grandeza do controle F. Não há base para escolher um corte que classifique os conflitos corretamente sem prejudicar notas reais.

Em F, o modelo continua examinando o par 55/74; as outras alturas da frase não são modeladas integralmente. Nas janelas reais, cada frame abrange cerca de 92,9 ms, podendo misturar notas vizinhas. A suposição de envelope estável é frágil para distorção, ataques e timbres que evoluem. O ganho é apenas uma característica candidata para um resolvedor futuro.

### 7.1 Controle de ambiguidade D

Foi construída uma fonte grave com parciais 1, 2, 3 e 4, mais uma fonte em exatamente 3× a frequência grave com parciais 1 e 2, mesmos ataques, envelopes e fases compatíveis. A mesma onda pode ser produzida por uma única fonte grave com outras amplitudes nos parciais 3 e 6.

A diferença máxima de amostra antes da escrita do WAV foi `3,323 × 10⁻⁹`, decorrente de arredondamento numérico. Os ajustes H0/H1 para as duas construções são praticamente iguais. Portanto, um resultado com preferência pelo modelo mais simples não prova que não havia segunda fonte.

Este controle usa a relação harmônica exata. Ré5 temperado fica aproximadamente 1,955 cents abaixo do terceiro harmônico de Sol3; essa distinção não é resolvida pela análise curta usada aqui. Não se afirma que toda gravação de duas notas sincronizadas seja matematicamente indistinguível.

Dados, envelopes e erros: [harmonic-model-2026-11-12.json](research/harmonic-model-2026-11-12.json).

## 8. Direção revisada

1. **Não promover continuous-v1.** O diagnóstico do booleano está confirmado, mas a substituição ainda compromete casos conhecidos. Conservar o protótipo como baseline experimental e os cenários que o refutam.
2. **Conservar Basic Pitch e suas hipóteses.** Os controles mostram que ele contém melodias agudas úteis mesmo quando produz falsas detecções; não usar MELODIA/Klapuri como filtros obrigatórios.
3. **Investigar geração complementar de candidatos.** Klapuri/MultiPitchMelodia podem sugerir fundamentais ausentes. A pontuação precisa distinguir evidência complementar de confirmação falsa de um mesmo parcial.
4. **Desenvolver o resolvedor como módulo separado.** Associar evidência de ataques, envelope, parciais residuais e trajetórias a cada relação entre eventos. Separar existência de nota e relevância para a primeira voz. Expor incerteza; não excluir cedo as hipóteses ambíguas.
5. **Adicionar contexto de frase e repetição depois de validar as características acústicas.** Repetição de harmônicos também é consistente; não copiar automaticamente uma ocorrência. Essa etapa ainda não foi implementada nem medida.
6. **Obter referências alinhadas de músicas diversas antes de decidir sobre produção.** Congelar trechos de desenvolvimento e teste por obra/fonte, incluindo melodias graves, agudas suaves, acordes consonantes, silêncios reais e timbres distorcidos. Medir acurácia temporal de altura, precisão/recall de eventos e fidelidade da voz principal, além de avaliação auditiva sem revelar a variante.

O resultado atual sustenta pesquisar um módulo próprio de resolução e fusão de evidências. Ainda não sustenta substituir o transcritor, anunciar um algoritmo geral pronto ou afirmar melhoria perceptiva nas músicas reais.

## 9. Reproduzir e inspecionar

O aplicativo e seu cache não foram modificados por esta fase. O SHA-256 do `score.mjs` atual continua igual ao baseline congelado no protocolo. Os scripts só geram cópias experimentais e artefatos locais.

```bash
# Usar diretórios novos: os preparadores recusam sobrescrever um run.
node scripts/research-harmonic-prototype.mjs downloads/research/phase2-replay
node scripts/research-harmonic-validation.mjs downloads/research/phase2-replay
node scripts/research-harmonic-symbolic.mjs downloads/research/phase2-replay

# Requer a instalação isolada de Essentia utilizada na pesquisa anterior.
./run.sh scripts/research-multipitch.py \
  downloads/research/20261112T164100.748825Z \
  downloads/research/multipitch-replay \
  --essentia-path /tmp/motor-orchestra-essentia

./run.sh scripts/research-harmonic-model.py \
  downloads/research/20261112T164100.748825Z \
  downloads/research/multipitch-replay \
  downloads/research/multipitch-replay/harmonic-model.json

node scripts/research-harmonic-summary.mjs \
  downloads/research/phase2-replay downloads/research/multipitch-replay

node --test tests/orchestra.test.mjs
```

O script multipitch atual já reinsere os quadros vazios. `research-multipitch-align.py` é a migração usada para corrigir a primeira execução; não precisa ser executado nos novos runs.

Os resultados desta fase foram gerados pelos scripts locais, não pela revisão externa. [O resumo estruturado](research/harmonic-phase2-summary-2026-11-12.json) reúne hashes dos scripts, hashes dos artefatos, protocolo e decisão de não promover o protótipo. WAVs, mapas brutos, conjuntos de alturas e arranjos completos de quatro motores permanecem nos diretórios locais dos runs.
