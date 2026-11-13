# Dossiê de pesquisa: preservar a melodia ao reduzir áudio a poucas vozes

**Projeto:** Sinfonia de Motores.  
**Data do levantamento:** 12 de novembro de 2026, America/Sao_Paulo.  
**Destinatário:** agente de pesquisa sem acesso à conversa, ao computador ou ao repositório.  
**Natureza:** briefing técnico, evidências locais, histórico e especificação da pesquisa. Não é uma revisão da literatura nem a apresentação de um algoritmo validado.

Este documento contém o contexto necessário para pesquisar o problema de forma independente. Os caminhos locais servem para identificar a origem dos dados; o agente não precisa conseguir abri-los. Dados relevantes, parâmetros e código foram incorporados aos apêndices. Os áudios completos, pesos de modelos e partituras de referência não estão incorporados ao Markdown.

## 1. Pedido e objetivo do usuário

O usuário constrói um aplicativo que transforma músicas em uma pequena orquestra de vozes monofônicas. A implementação inicial usa sons de motores de passo virtuais; também foi acrescentado um timbre de sinos. O pedido de sinos era **trocar o som base mantendo a música**, e não construir uma nova orquestra acústica ou reconhecer automaticamente instrumentos.

O problema musical continua: certos trechos ficam reconhecíveis, mas a melodia principal perde notas, apresenta buracos ou é substituída por outras alturas. O usuário citou especificamente *Bergentrückung + ASGORE* e *MEGALOVANIA*. Quer uma pesquisa objetiva que possa orientar melhorias profundas, inclusive um algoritmo novo se houver justificativa.

**Objetivo perceptivo:** com poucas vozes, a música deve continuar reconhecível pelo tema, pelo ritmo e pelo suporte harmônico. Explicar a maior quantidade de energia espectral possível não demonstrou ser um substituto adequado para esse objetivo.

Não se exige inventar um algoritmo. A pesquisa deve demonstrar quando uma abordagem existente resolve o problema, quando uma combinação é suficiente e onde há uma lacuna que justifique desenvolvimento próprio.

## 2. O que existe e o que ainda não temos

| Item | Situação |
|---|---|
| Aplicativo local no navegador | Implementado, Python + JavaScript + Web Audio |
| Transcrição de áudio polifônico | Spotify Basic Pitch 0.4.0, backend ONNX |
| Três densidades de candidatos | Implementadas: normal, média e alta |
| Filtro numérico de intensidade | Implementado em todos os modos; pode ser zero |
| Arranjo em vozes monofônicas | Implementado com seleção sequencial de cadeias por programação dinâmica |
| Priorização de melodia | Heurística de registro, confiança relativa, continuidade e penalidade de harmônicos |
| Identificação de instrumentos ou stems | Não implementada |
| Separação de fontes para transcrição tonal | Não implementada; HPSS existe no detector de percussão |
| Extração independente de F0 | Apenas investigação exploratória com pYIN; não faz parte do pipeline |
| Afinação global antes da transcrição | Implementada com detecção conservadora de desvio |
| Sons | Senoide ideal, simulação mecânica e sinos sintéticos |
| Protótipo físico de motores | Planejado; não montado nem calibrado |
| Gabarito alinhado de ASGORE e MEGALOVANIA | Não disponível |
| Avaliação auditiva controlada com participantes | Não realizada |
| Validação de fidelidade em conjunto independente | Não realizada |

Há testes automatizados de propriedades e alguns benchmarks sintéticos. Isso demonstra funcionamento de partes do sistema, mas não comprova que a primeira voz corresponda à melodia percebida em músicas reais.

O código estava com várias alterações não commitadas. O commit conhecido `6f01683` não representa sozinho o estado descrito aqui. Há uma heurística experimental de harmônicos no diretório atual; ela **não deve ser tratada como solução final**. Seus resultados e limitações são separados abaixo.

## 3. Pipeline atual e unidades

```text
YouTube / áudio já baixado
  → WAV original
  → estimativa de afinação global
  → eventual WAV temporário com taxa de amostragem corrigida
  → Basic Pitch: ativações de notas, ataques e contornos
  → decodificação e ajustes de eventos, em três densidades
  → tempos restaurados para a duração original
  → JSON em cache
  → filtro de intensidade escolhido pelo usuário
  → seleção de notas e distribuição em N linhas monofônicas
  → tratamento de articulação, sustentações e continuidade
  → Web Audio: senoide / motor / sino
```

Em paralelo, um detector HPSS/CQT extrai golpes de percussão. Quando a opção de percussão está ligada e há golpes disponíveis, o último motor é reservado a ela. Portanto, **quatro motores totais podem significar três vozes tonais mais uma percussiva**.

Os orçamentos usados nos scripts são 1, 2, 3, 4, 6, 8 e 12 motores. A interface começa com três; não se deve confundir esses orçamentos de avaliação com um limite rígido da interface.

### 3.1 Contrato da transcrição

Uma nota tonal no JSON tem o formato:

```json
[0.499, 0.685, 57, 0.506, null]
```

Campos: início em segundos, fim em segundos, altura MIDI, intensidade média da ativação da rede e curva fina de afinação opcional. Esse exemplo é um candidato real do início de MEGALOVANIA, não uma anotação de referência.

Um job tem esta estrutura; o exemplo estrutural abaixo é reduzido e não representa uma faixa completa:

```json
{
  "id": "identificador-do-video",
  "status": "ready",
  "analysis_version": 10,
  "title": "Título",
  "duration": 2.0,
  "tuning_cents": 0.0,
  "notes": [[0.0, 0.5, 60, 0.8, null]],
  "density": {
    "media": [[0.0, 0.5, 60, 0.8, null]],
    "alta": [[0.0, 0.5, 60, 0.8, null]]
  },
  "drums": [[0.5, "kick", 0.8]]
}
```

`notes` é a densidade normal. Média e alta são listas completas de candidatos, não listas de diferenças. A intensidade não é volume acústico medido nem probabilidade calibrada de a nota estar correta.

### 3.2 Contrato do arranjo

```javascript
{
  title: 'Título',
  duration: 2,
  tracks: [
    [{ start: 0, end: 0.5, midi: 60, vel: 0.8 }]
  ],
  roles: ['']
}
```

Cada `track` é ordenada e não tem notas simultâneas. Podem existir `bends`, `span`, `reattack`, `double` e propriedades de percussão. A mesma partitura alimenta todos os timbres.

Afinação: `f(midi) = 440 × 2^((midi − 69) / 12)`. MIDI 60 = Dó4; 69 = Lá4.

## 4. Transcrição: parâmetros e cuidados já implementados

### 4.1 Basic Pitch e densidades

Modelo polifônico pré-treinado, sem treinamento ou adaptação próprios. Faixa pedida à decodificação: 30–4200 Hz. Áudio da análise: mono a 22050 Hz. O hop de referência da rede é 256 amostras, aproximadamente 11,61 ms; a biblioteca aplica sua correção de tempo entre janelas.

| Densidade | Limiar de ataque | Limiar de ativação por quadro |
|---|---:|---:|
| Normal | 0,50 | 0,30 |
| Média | 0,35 | 0,20 |
| Alta | 0,25 | 0,15 |

O limiar da rede por quadro **não é a mesma grandeza operacional** que o filtro posterior sobre a intensidade média de uma nota. Colocar o filtro da interface em zero mantém os eventos já detectados; não produz notas ausentes na saída do transcritor.

### 4.2 Decodificação longa e notas rápidas

Primeira passagem: `min_note_len=11`, `infer_onsets=True`, `melodia_trick=True`, tolerância de energia padrão da biblioteca. Na versão inspecionada, o decodificador rejeita comprimentos `<= min_note_len`; distinguir o parâmetro nominal da quantidade efetivamente aceita é importante para reproduzir testes.

Segunda passagem: `min_note_len=4`, `energy_tol=3`, `infer_onsets=False`, `melodia_trick=False`, ataque mínimo `max(0.35, onset)` e quadro mínimo `max(0.2, frame)`. Só acrescenta eventos de até 11 quadros, com intensidade suficiente e sem sobreposição com um evento existente da mesma altura. Isso recupera eventos de aproximadamente 58–128 ms sem aceitar todo resíduo curto.

As matrizes são copiadas antes de cada decodificação: `constrain_frequency` da biblioteca pode alterá-las in-place. Não foi demonstrado um defeito de mutação geral da rede; evitar atribuir o problema musical a essa hipótese sem evidência.

### 4.3 União de falsas quebras

Fragmentos da mesma altura separados por até três quadros podem ser unidos quando o ataque seguinte é inferior a 0,7. Um ataque de pelo menos 0,35 após uma queda de energia abaixo de metade da intensidade dos eventos preserva a repetição. A intensidade da união é calculada pela média dos quadros.

Risco: unir re-ataques verdadeiros. O histórico registra recuperação de 93% das quebras e união indevida de 4% dos re-ataques em um teste anterior; esses números não foram recalculados para todo o pipeline atual.

### 4.4 Afinação global

Antes da rede, o app usa até 40 s distribuídos pela gravação para analisar picos espectrais com `librosa.piptrack`: FFT 4096, hop 1024, frequências 150–4000 Hz, threshold 0,3. Considera a metade mais forte dos picos e estima o desvio com resolução de 0,01 semitom.

Só aplica compensação quando:

- o módulo do desvio estimado é pelo menos 0,15 semitom = 15 cents;
- pelo menos 50% do peso dos picos selecionados fica a até 0,10 semitom da afinação estimada.

Com desvio `d` em semitons, escreve um WAV temporário com `sr_corrigido = round(22050 × 2^(−d/12))`. A rede o lê na sua taxa habitual. Os tempos detectados são multiplicados por `sr_corrigido / 22050` para voltar à escala da gravação. O WAV original não é modificado. Não é um pitch shift com phase vocoder.

Essa é uma heurística local, não uma solução validada para toda combinação de instrumentos desafinados ou temperamentos. Foi testada com tons conhecidos, acorde afinado, ruído, silêncio, preservação do arquivo original e escala de tempo.

### 4.5 Afinação fina

O contorno usa três bins por semitom. A implementação calcula um centróide em torno do pico numa janela de aproximadamente ±1,3 semitom, subtrai o desvio mediano estimado, interpola quadros fracos, suaviza e guarda amostras a cada dois quadros. Curvas muito pequenas são omitidas.

O histórico do projeto aponta viés próximo de +0,31 semitom em um gabarito afinado em Lá 440. Isso foi medido naquele gabarito, não estabelecido como constante universal da rede.

## 5. Arranjo: como as notas são escolhidas hoje

### 5.1 Preparação e valor de uma nota

Descarta eventos inválidos, alturas fora de MIDI 0–127 e durações menores que 30 ms. Para a mesma altura e ataque, mantém o candidato mais forte. Um ataque posterior da mesma altura encerra a cauda anterior, mesmo quando ela veio de outro instrumento. Isso evita uníssonos duplicados, mas perde informação de identidade instrumental.

Para intensidade `a`, limitada a [0,1]:

```text
velocity = min(1, 0.4 + 0.8a)
weight   = (0.4 + 1.6a) × min(1, 0.25 + 1.25a)
```

`weight` é valor por segundo para selecionar notas. `velocity` é amplitude de reprodução. A seleção usa a intensidade antes da saturação de volume, que acontece a partir de `a=0.75`.

### 5.2 Busca de cadeias

Para cada voz, uma programação dinâmica maximiza valor acumulado de notas, aproximadamente intensidade ponderada × duração executada, descontando saltos e interrupções. A cadeia escolhida sai da disputa; a próxima voz é otimizada sobre o restante.

Isso é **seleção sequencial de cadeias**, não otimização conjunta de todas as vozes nem reconhecimento treinado de melodia.

Parâmetros gerais:

```text
tail=0.10 s; intC=0.25; intK=1.0
jumpC=0.4; jump0=7 semitons
phrase=0.50 s; noteC=0.02; minPlay=0.08 s
```

Na primeira voz do modo melodia:

```text
intC=0.10; intK=0.25
jumpC=1.6; jump0=5 semitons; noteC=0.005
```

Saltos maiores que `jump0` custam `jumpC × (salto − jump0) / 12`. Interromper uma nota antes de sua cauda tolerada tem custo fixo e proporcional ao restante. Após um intervalo maior que `phrase`, a frase pode reiniciar sem esses custos. Notas naturalmente menores que `minPlay` podem ser executadas inteiras.

### 5.3 Três modos

- **Papéis:** primeira linha escolhe notas agudas em faixa fixa, baixo escolhe graves e vozes intermediárias completam. É o método mais antigo mantido para comparação.
- **Linhas dinâmicas:** seleção por valor e continuidade, sem reservar a primeira voz para uma melodia explicitamente estimada.
- **Redução orquestral / melodia primeiro:** altera a prioridade da primeira cadeia para favorecer o registro superior da textura local, mantendo continuidade; segunda linha recebe preferência pelo fundamento grave.

### 5.4 Prioridade melódica e o risco de preferir harmônicos

A janela local considera vizinhas até 500 ms do ataque e notas ainda sustentadas. Vizinhas fortes determinam percentil de altura `rank` e centro de registro `center`.

```text
register = 2 ^ clamp((midi − center) / 12, −2, 2)
priority = (0.15 + 3.85 × rank³ × register × confidence)
           × harmonicShadow × continuity
```

O piso de intensidade relativo é `max(0.18, maior_intensidade_local × 0.5)`. A confiança combina intensidade relativa e apoio de notas próximas em altura e tempo. Picos agudos curtos sem continuação podem receber menos valor quando competem com sustentação.

Essa fórmula pode dar prioridade muito maior a uma cópia aguda fraca que a uma fundamental forte, caso a penalidade de harmônicos falhe. Em um diagnóstico anterior ao experimento atual, MIDI 55 tinha prioridade aproximadamente 0,655 e MIDI 74 aproximadamente 7,370 no mesmo ataque de MEGALOVANIA, antes de multiplicar pelo peso e duração.

A heurística penaliza oitavas e intervalos de 19, 28 e 31 semitons quando coincidem com uma nota inferior mais forte. São aproximações em MIDI de relações harmônicas; não provam, por si só, que uma nota seja espúria. A existência de movimento independente nas notas vizinhas pode retirar a penalidade para proteger uma melodia aguda real.

**Defeito observado:** exigir finais quase iguais e procurar apenas correspondências locais pode classificar harmônicos com decaimento diferente como linhas independentes. A heurística experimental passou a considerar cobertura temporal e fundamentais repetidas; ainda há falsos resultados. O código atual e a prioridade anterior estão nos apêndices, permitindo comparar as duas versões sem depender do histórico Git.

### 5.5 Harmonia, acompanhamento e dobramentos

- A opção `harmony` estima tonalidade em blocos de 4 s, com janela de cerca de 12 s, usando perfis de Krumhansl-Kessler. Notas fracas fora da escala podem valer até 50% menos. Uma nota forte próxima da mesma classe retira o desconto. Cromatismos verdadeiros também podem ser prejudicados.
- A segunda linha recebe bônus para notas abaixo da melodia; não há reserva rígida de uma faixa MIDI para o baixo nesse modo.
- `voicing` diminui duplicações de classes já representadas e favorece funções do acorde aproximadas a partir da voz mais grave. Não há detector completo de acordes.
- `double` permite cópias da melodia uma oitava abaixo a partir da terceira voz tonal, com 70% do valor e 80% do volume. São notas explicitamente sintetizadas pelo arranjo e marcadas `double`, não novas detecções acústicas.

### 5.6 Articulação e continuidade

- Legato pode preencher até 120 ms, limitado à metade da duração de cada vizinha e a saltos de no máximo sete semitons. Não pode atravessar um novo ataque da mesma altura.
- Uma nota cortada em mais de 100 ms pode ser transferida inteira para outra voz livre desde seu ataque original. Na redução melódica, isso não modifica a primeira voz.
- Continuações inteiras podem trocar de motor para reduzir saltos, preservando notas, durações e volumes, sem aumentar a contagem de pausas de 30–300 ms. Na redução, a primeira linha fica fixa.
- Repetições próximas da mesma nota podem manter o motor girando e marcar o ataque com uma queda de volume de 30 ms.

Continuar uma nota errada ou sustentar um acompanhamento não é equivalente a recuperar a melodia. A pesquisa deve medir ambos separadamente.

## 6. Reprodução, timbre e restrições físicas

O arranjo pode ser ouvido com senoides ideais, motores ou sinos. Para investigar seleção de notas, a senoide é a referência mais direta: o motor também altera frequência e envelope por sua dinâmica. Sinos têm ataque curto e caudas que se sobrepõem; uma voz de eventos monofônicos pode, portanto, produzir várias caudas audíveis ao mesmo tempo. Comparações perceptivas devem controlar esse efeito.

O agendamento usa AudioContext, lookahead de 120 ms, timer de aproximadamente 25 ms e simulação mecânica a 250 Hz. O timer não gera amostras de áudio. Alterações refazem o agendamento a aproximadamente 15 ms no futuro.

Parâmetros mecânicos atuais: 200 passos/volta, micropassos 1, máximo de 900 RPM, aceleração de 30000 RPM/s, inércia 1, constante de resposta 8 ms, driver até 20000 pulsos/s, ressonância natural 700 Hz, intensidade 0,5 e amortecimento 0,15.

Na hipótese adotada pelo simulador, a frequência da nota corresponde à taxa de passos completos; com 200 passos/volta e 900 RPM, o limite de taxa é 3000 passos/s. Essa correspondência acústica é uma escolha de modelagem inspirada em motores musicais, não uma lei universal de qualquer montagem.

O modelo usa dinâmica de primeira ordem, limitação de aceleração, ressonância e perda estocástica de passos. Não modela torque, corrente, posição do rotor ou carga real. O timbre é fenomenológico. Nenhuma dimensão de hardware foi validada em bancada.

O plano físico prevê microcontrolador e drivers recebendo linhas monofônicas via MIDI. Para a pesquisa inicial, não transformar essas escolhas de hardware em restrições artificiais da extração de melodia. Avaliar primeiro as notas e depois a adaptação aos limites físicos.

## 7. Casos reais, medições e experimentos

### Comparação congelada do arranjador anterior e do experimento atual

Extraída diretamente dos caches e das duas implementações. Aqui a transcrição é a mesma dentro de cada música: ASGORE já tem compensação de afinação e MEGALOVANIA não teve correção aplicada. O arranjador anterior foi preservado em uma cópia temporária antes da mudança de harmônicos. A implementação atual é experimental e seus testes de propriedades não comprovam ganho perceptivo.

Configuração comum: quatro motores totais, percussão ligada, densidade alta, `threshold=0.15`, `harmony=true`, `voicing=true`, `double=true`, `continuity=true`, `bends=false`, `mix=false`. Nas duas faixas há percussão, portanto são três linhas tonais e uma percussiva. Os números abaixo se referem somente à primeira linha tonal.

| Faixa | Versão | Eventos | Ocupação total | Pausas >150 ms | Soma das pausas | Ocupação em 0–8 s |
| --- | --- | --- | --- | --- | --- | --- |
| MEGALOVANIA | Arranjador anterior | 309 | 77.6308% | 73 | 28.4400 s | 38.2000% |
| MEGALOVANIA | Experimento atual | 321 | 78.7038% | 71 | 27.2550 s | 57.5000% |
| ASGORE já afinado para análise | Arranjador anterior | 439 | 87.5596% | 53 | 15.3580 s | 84.8625% |
| ASGORE já afinado para análise | Experimento atual | 437 | 87.4701% | 53 | 15.5130 s | 84.8625% |

A melhora de ocupação em parte do riff de MEGALOVANIA convive com falhas ainda presentes depois. Em ASGORE, o experimento de arranjo piorou ligeiramente ocupação e soma de pausas nesse indicador, sem mudar sua contagem. Portanto, ele não é uma melhora uniforme nem uma solução aprovada. Falta medir notas corretas e escuta.


### 7.1 Como interpretar os números

`Ocupação` é a soma das durações da primeira voz dividida pela duração do áudio. `Pausas >150 ms` conta diferenças internas entre o fim de uma nota e o começo da seguinte, estritamente maiores que 0,15 s. Não inclui automaticamente silêncio antes da primeira nota ou após a última. A soma dessas pausas também inclui pausas musicais legítimas.

Não há gabarito humano alinhado para as duas faixas. Portanto, nenhuma dessas contagens deve ser apresentada como porcentagem de melodia correta.

### 7.2 ASGORE: problema de afinação da entrada

Fonte: [Bergentrückung + ASGORE](https://www.youtube.com/watch?v=PJ1yqbr8Y50). Título no cache: “Bergentrückung + ASGORE by Toby Fox but I perfected the gap between the songs”. Duração aproximada: 173,186 s.

Antes da compensação, havia várias detecções alternando entre semitons vizinhos e sustentações interrompidas. O desvio global estimado foi −38 cents. Em análise exploratória dos picos fortes, aproximadamente 52,2% do peso ficou perto da afinação estimada; em *Test Drive*, o mesmo procedimento encontrou cerca de +3 cents e não aplicou correção.

Em comparação histórica com o mesmo arranjador, quatro motores totais, percussão ligada, redução, densidade alta, opções harmônicas ligadas e **sem o filtro posterior `threshold`**, a compensação produziu:

| Métrica da primeira voz | Sem compensar | Compensando |
|---|---:|---:|
| Eventos selecionados | 393 | 447 |
| Ocupação | 65,63% | 88,50% |
| Pausas internas >150 ms | 133 | 48 |
| Soma dessas pausas | 52,41 s | 13,51 s |

O número de candidatos passou de 287 para 1781 na densidade normal, de 1231 para 2921 na média e de 2222 para 3850 na alta. Mais candidatos não significam automaticamente mais notas corretas.

Esse experimento alterou a transcrição. Não atribuir o ganho a uma nova distribuição de vozes. A tabela automaticamente extraída acima usa filtro posterior 0,15 e também compara uma heurística experimental de arranjo; é outra comparação, com outro objetivo.

### 7.3 MEGALOVANIA: harmônicos e identidade da frase

Fonte: [MEGALOVANIA](https://www.youtube.com/watch?v=0FCvzsVlXpQ). Duração: 156 s. Cache de análise versão 10. O estimador não aplicou correção global: `tuning_cents=0.0` significa ausência de compensação pelos critérios atuais, não prova de afinação perfeita.

Candidatos: 1052 na densidade normal, 1805 na média e 2359 na alta. Há notas fortes do riff no cache que não aparecem na primeira voz. Exemplos reais, sem as curvas finas:

| Início (s) | Fim (s) | MIDI | Intensidade | Observação |
|---:|---:|---:|---:|---|
| 0,058 | 0,441 | 62 | 0,372 | Evento que pode misturar harmônico inicial e nota seguinte |
| 0,128 | 0,279 | 50 | 0,400 | Candidato inferior concorrente; limites temporais suspeitos |
| 0,499 | 0,685 | 57 | 0,506 | Nota forte disponível para a frase |
| 0,871 | 1,057 | 56 | 0,489 | Nota forte disponível para a frase |
| 1,126 | 1,312 | 55 | 0,481 | Fundamental candidata forte |
| 1,126 | 1,265 | 74 | 0,189 | Concorrente +19 semitons, selecionada no arranjo anterior |
| 1,382 | 1,614 | 72 | 0,159 | Concorrente aguda de curta duração |
| 1,428 | 1,753 | 53 | 0,400 | Candidata inferior +46 ms no ataque, cauda mais longa |

Os valores completos desse trecho e as saídas da primeira voz estão nos apêndices. As alturas MIDI 55 e 74 têm relação próxima de 1:3 em frequência; o intervalo é 19 semitons, não uma oitava. Essa é evidência útil para uma hipótese de harmônico, mas a mesma relação pode ocorrer entre notas musicais independentes.

No arranjo anterior, a primeira voz começa com MIDI `62, 74, 72, 67, 62, ...`, deixando de selecionar várias notas fortes inferiores. O experimento atual recupera uma sequência como `62, 57, 56, 55, 53, 53, 55, ...` nos primeiros segundos. **Ainda falha em ciclos posteriores e não corrige todos os ataques.** Não existe comprovação de que todas essas escolhas sejam as notas canônicas da gravação.

### 7.4 Experimento de F0 com pYIN

Rodou-se `librosa.pyin` no começo da gravação, áudio mono a 22050 Hz, frame 2048 e hop 256. Uma execução usou `fmin=70`, `fmax=1000` Hz. Aproximadamente:

```text
0.000–0.221 s: MIDI 50
0.267–0.441 s: MIDI 62
0.464–0.685 s: MIDI 57
0.848–1.057 s: MIDI 56
1.091–1.312 s: MIDI 55
1.347–1.602 s: MIDI 53
1.637–1.730 s: MIDI 50
1.753–1.858 s: MIDI 53
1.869–1.985 s: MIDI 55
```

Isso ajuda a formular a hipótese de erro de harmônicos e de uma nota MIDI 62 que abrange regiões distintas. Porém, **pYIN não é gabarito**. Numa execução com faixa 65–1500 Hz, as probabilidades de vozeamento ficaram baixas em vários trechos do timbre distorcido: aproximadamente 0,07 perto de 0,15 s; 0,21 em 0,55 s; 0,28 em 0,95 s; cerca de 0,01 em parte das notas Fá. Em muitos trechos polifônicos posteriores retornou F0 indefinida.

Não incorporar essa leitura monofônica indiscriminadamente à música inteira. Ela pode seguir baixo, sub-harmônicos ou outra fonte e tem incerteza substancial neste áudio.

### 7.5 Experimentos de filtragem antes da rede

Foram exploradas versões dos primeiros oito segundos com filtros Butterworth causais:

- passa-baixa de segunda ordem em 500 Hz;
- passa-baixa de segunda ordem em 1500 Hz;
- passa-baixa de primeira ordem em 120 Hz, como inclinação espectral forte.

As versões filtradas foram normalizadas para o RMS do trecho original, gravadas em WAV e analisadas pela mesma rede e decodificador. Uma versão sem filtro do mesmo recorte foi criada depois para controlar a comparação de duração. Analisar um recorte de oito segundos não é idêntico a cortar a saída de uma inferência da faixa inteira: janelas da rede e normalização de ataques podem diferir.

As saídas mostram fundamentais fortes em algumas versões, mas várias dessas fundamentais **já existem na transcrição sem filtro**. Não há demonstração de melhora geral. O filtro também pode enfraquecer melodias agudas ou destacar o baixo em texturas densas. Esses experimentos não foram integrados ao app.


| Entrada do trecho de 8 s | Candidatos na densidade alta | Evento MIDI 56 perto de 0,9 s | Intensidade |
| --- | --- | --- | --- |
| unfiltered-8s | 74 | 0.871–1.057 | 0.493 |
| lowpass-500 | 65 | 0.917–1.068 | 0.476 |
| lowpass-1500 | 54 | 0.871–1.057 | 0.492 |
| tilt | 66 | 0.917–1.068 | 0.538 |

A presença do evento na versão sem filtro mostra por que reforçar sua intensidade não basta se o arranjador continuar escolhendo outra altura.

## 8. Histórico de tentativas e resultados anteriores

Os números desta seção foram registrados no README preexistente. Não foram todos recalculados nesta sessão, algumas rotinas antigas ficaram fora do projeto e não há garantia de que suas versões coincidam com o código atual. Tratar como histórico de desenvolvimento, não como benchmark científico consolidado.

### 8.1 Comparação num gabarito sintético

Composição própria *Engrenagens*, renderizada com melodia com vibrato, arpejo dedilhado, baixo, pad e bateria; quatro motores. Cobertura de melodia/baixo em qualquer motor e F1 de eventos com tolerância de ataque de ±50 ms:

| Método histórico | Melodia | Baixo | F1 |
|---|---:|---:|---:|
| Picos CQT por quadro | 52% | 98% | 0,38 |
| Papéis + Basic Pitch | 83% | 95% | 0,60 |
| NMF com dicionário de sons de motor | 11% | 85% | 0,35 |
| Soma de Fourier por resíduo | 78% | 96% | 0,33 |
| Linhas dinâmicas, densidade média | 85% | 94% | 0,57 |

O baixo do método CQT aparecia picotado e em motores sem identidade estável. Cobertura em qualquer motor ocultava parte desse defeito.

A soma por resíduo escolhia por Viterbi uma altura ou silêncio a cada cerca de 23 ms, subtraía a contribuição estimada e passava ao próximo motor. Sua semelhança espectral média era boa, mas a escuta perdeu o tema ao privilegiar harmônicos e sustentações energéticas. Foi removida.

O fracasso dessa NMF com um dicionário específico de sons de motor **não demonstra que toda NMF ou toda representação por templates falhe**. O fracasso da implementação espectral também não invalida qualquer função objetivo acústica; demonstra que faltava uma relação adequada com o alvo perceptivo.

### 8.2 Textura sintética com doze vozes

Tema de oito notas `76,78,79,76,74,76,79,78`, cada uma com 0,5 s e intensidade 0,4. Onze sustentações simultâneas em `36,43,48,50,52,55,57,59,60,62,64`, duração 4 s, intensidade 0,6.

Nesse caso construído, o modo anterior só incluía o tema com doze motores; a redução melódica o preservava inteiro no primeiro. É um teste útil para o defeito de competição por energia, não uma amostra representativa de toda música orquestral. A fixture exata está incorporada adiante.

Em uma comparação histórica de *Test Drive* (`IpPIK4T068s`), a primeira voz mudou de registro médio MIDI 39,36 para 67,39; ocupação de 92,72% para 89,67%. Isso demonstra mudança de seleção, não identifica automaticamente o tema correto.

### 8.3 Outros achados registrados

- Em *DBZ Budokai 3 Opening (Instrumental)* (`Et3NQPnxtqY`), uma revisão anterior reduziu pausas >300 ms de 30 para 17 e saltos maiores que uma quinta de 34 para 19, com tempo tocado de 172,69 para 179,91 s. Pausas >50 ms subiram de 115 para 119. Sem partitura alinhada, não é prova de fidelidade da guitarra.
- A saliência e recuperação de sustentações melhoraram algumas métricas sintéticas, mas houve configuração com seis motores em que a precisão temporal caiu de 79,80% para 78,89%.
- Um teste de tin whistle registrou erro mediano de afinação de 25 para 17 cents com curvas, mas correlação do movimento fino próxima de 0,2 após suavização; não representa recuperação fiel de vibrato rápido.
- A percussão acertou aproximadamente 84% dos golpes com F1=0,67 em um gabarito, mas confunde peças. Não foi separação instrumental treinada.
- Avaliar notas “fora do tom” usando a mesma estimativa tonal que orienta o algoritmo introduz viés circular. O próprio README reconhece essa limitação.

## 9. Testes, auditorias e o que eles não demonstram

Última execução registrada após a heurística experimental: **65 testes JavaScript aprovados**. Uma execução anterior do ambiente Python completo aprovou **22 testes**, incluindo decodificação e afinação. Rodar apenas o Python do sistema pula testes quando faltam numpy/Basic Pitch.

Uma auditoria anterior à mudança experimental de harmônicos percorreu **32 caches e 2688 configurações**, verificando propriedades de arranjo. Houve também auditoria de 84 configurações da transcrição corrigida de ASGORE. Esses resultados não devem ser atribuídos automaticamente ao novo experimento ou a todos os caches disponíveis agora.

Propriedades verificadas incluem: ausência de sobreposição por motor; ataques vindos dos candidatos, com exceção dos dobramentos marcados; ausência de uníssonos duplicados; preservação de volume, curva e duração na recuperação de caudas; manutenção da primeira voz quando a recuperação deve preservá-la.

Nenhuma dessas propriedades confirma que o candidato acústico seja uma nota verdadeira, que uma pausa seja um erro ou que a linha escolhida seja o tema.

O avaliador com referência usa grade de 10 ms para cobertura por voz e precisão/recall de conjuntos de alturas. O indicador “cobertura por voz de referência” aceita acerto em **qualquer** motor, não necessariamente na primeira linha. Não é F1 de ataques nem avaliação perceptiva. O código exato está no apêndice.

## 10. Hipóteses e perguntas que a pesquisa precisa resolver

1. Qual parcela do problema vem de candidatos ausentes, de eventos mal delimitados, de erros de oitava/harmônicos e de seleção entre candidatos corretos?
2. Como distinguir harmônicos de uma fonte de uma linha musical independente quando os ataques coincidem, mas as caudas diferem?
3. Como usar evidência acústica ou timbral sem simplesmente privilegiar energia?
4. Quando um extrator de melodia predominante ajuda e quando segue o baixo ou falha no timbre distorcido?
5. Separação de fontes seguida de transcrição melhora o resultado final ou introduz artefatos e erros de ataque?
6. A seleção sequencial de cadeias deve ser substituída por otimização conjunta? Como representar identidade de frase, voz e instrumento?
7. Repetições de motivos podem permitir recuperação de eventos ausentes, sem copiar notas para pausas intencionais ou variações reais?
8. Uma representação contínua de F0 deve preceder a quantização MIDI? Como preservar vibrato e distinguir cromatismos de erros?
9. Como adaptar a quantidade de vozes ao conteúdo e mostrar o que não cabe no orçamento, sem depender de aumentar N para que o tema apareça?
10. Como apresentar ao usuário controles previsíveis de densidade e intensidade, sem ocultar cortes internos arbitrários?

Não tomar como premissas que a melodia seja sempre a mais alta, a mais forte ou uma única fonte durante toda a faixa. Uma melodia grave e suave também pode ser o alvo.

Há ambiguidade física real: uma fundamental com harmônicos e vários instrumentos tocando oitavas/quintas podem produzir espectros semelhantes. Explicar como o método trata a ambiguidade, quais evidências adicionais utiliza e quando deve expressar incerteza.

## 11. Escopo solicitado ao agente de pesquisa

Investigue, com fontes primárias, métodos de extração de melodia predominante, transcrição polifônica, agrupamento harmônico e de timbre, rastreamento de parciais, separação de fontes, reconhecimento de fundamental ausente, grafos/HMM/Viterbi, otimização de múltiplas vozes e estrutura/repetição musical.

Compare ao menos uma alternativa exclusivamente de arranjo sobre os candidatos atuais, uma alternativa que modifique a frente acústica e uma arquitetura híbrida. A lista não obriga usar uma técnica específica.

Para até três arquiteturas finalistas, forneça:

- representação intermediária e significado das probabilidades/pesos;
- evidências acústicas, temporais, timbrais e musicais utilizadas;
- função objetivo e método de otimização;
- tratamento de oitavas, harmônicos, identidade de voz e repetições;
- estratégia para ataques, sustentações, pausas e incerteza;
- custo estimado e depois medido de CPU, memória e, se usado, GPU;
- vantagens, falhas esperadas, licença, disponibilidade de pesos e viabilidade local;
- explicação de por que ela pode melhorar os casos concretos deste documento.

O app atual funciona localmente em CPU, com Python no processamento e navegador na reprodução. Não há GPU garantida. A análise pode ser offline; o arranjo precisa continuar prático ao mudar N e os controles. Não há orçamento formal de latência definido: medir, não inventar um requisito numérico. O README cita aproximadamente 20–50 s para faixas de 3–4 minutos em uma versão anterior, sem especificação de máquina ou benchmark atual controlado.

Não treinar uma rede nova ou acrescentar dependências pesadas antes de mostrar a lacuna, o conjunto de dados e os ganhos esperados. Caso proponha aprendizagem, explicar supervisão, custo, generalização e avaliação fora das faixas de desenvolvimento.

## 12. Protocolo objetivo de avaliação solicitado

### 12.1 Separar as etapas

1. **Arranjo:** mesmos candidatos, métodos diferentes; avaliar o teto possível quando as notas corretas já estão disponíveis.
2. **Transcrição:** mesmo arranjador, candidatos de métodos diferentes.
3. **Reprodução:** mesma partitura, senoide/motor/sino e parâmetros documentados; separar erro musical de limitação mecânica ou mascaramento de timbre.
4. **Pipeline completo:** avaliar o benefício perceptivo com quantidade fixa de vozes.

### 12.2 Referências e alinhamento

Obter referências verificáveis e alinhadas: MIDI/partitura autorizada e compatível com a gravação, stems com notas conhecidas ou anotação manual revisada. Uma transcrição de outro modelo não deve ser promovida a verdade de referência sem verificação.

Documentar andamento, offsets, eventuais mudanças de velocidade/afinação da versão do vídeo e ambiguidade de oitava. Não impor a tonalidade ou a oitava de uma versão diferente da música.

### 12.3 Medidas mínimas

- precisão, recall e F1 de ataques com tolerância temporal explícita;
- altura exata e erros de oitava, além de eventual medida separada por classe de altura;
- duração/offset e preservação de notas repetidas;
- cobertura correta da melodia na primeira voz e em qualquer voz, como métricas distintas;
- ataques e sustentações falsos, pausas reais indevidamente preenchidas e notas verdadeiras ausentes;
- continuidade de frase e trocas de identidade entre vozes;
- cobertura de baixo e informação harmônica sob orçamento fixo;
- teste auditivo pareado e, se possível, cego, com ganho/timbre controlados;
- tempo de processamento, memória, dependências e sensibilidade aos parâmetros.

Reportar ocupação e número de buracos apenas como estatísticas auxiliares. O sucesso precisa preservar as notas certas e o tema, sem obter o ganho sustentando uma altura errada.

### 12.4 Conjunto de avaliação e ablações

Incluir MEGALOVANIA e ASGORE como casos de desenvolvimento, mas reservar músicas independentes para validação. Abranger voz, sopros, guitarra distorcida/sintetizadores, piano, orquestra densa, percussão forte, melodias graves/suaves e pausas legítimas.

Usar casos sintéticos com notas e stems conhecidos, ataques rápidos, oitavas/quintas verdadeiras, fundamental ausente, harmônicos que decaem antes, harmônicos que unem repetições, afinação deslocada, vibrato e cruzamento de vozes.

Comparar N=1,2,3,4,6,8,12; registrar separadamente N total e N tonal. Desligar dobramentos para medir recuperação de notas e depois medir seu efeito perceptivo separadamente.

Fazer ablações de afinação, frente acústica, harmônicos, registro, continuidade, harmonia, restauração de caudas e repetição de motivos. Manter os demais fatores fixos. Avaliar a faixa inteira e segmentos anotados; não ajustar o algoritmo apenas aos primeiros oito segundos do riff.

## 13. Entregáveis esperados

1. Diagnóstico com exemplos temporais e taxonomia dos erros.
2. Tabela de métodos e fontes primárias, separando resultados publicados de inferências para este projeto.
3. Arquitetura recomendada, alternativas e justificativa.
4. Especificação matemática ou pseudocódigo suficiente para um protótipo.
5. Experimentos, ablações, referências necessárias e critérios de aceitação.
6. Riscos, incertezas e o que não pode ser concluído com os dados atuais.
7. Caso um algoritmo novo seja recomendado, explicar a contribuição e o baseline que precisa superar.

O agente pode pesquisar na internet, consultar artigos, documentação oficial e repositórios dos autores. Deve checar versões, licenças e resultados atuais. Não precisa fingir acesso ao computador: quando faltar áudio, partitura, baseline executável ou anotação, deve dizer exatamente o que falta e propor como obtê-lo.

### Pontos de partida já presentes no projeto

- [Spotify Basic Pitch](https://github.com/spotify/basic-pitch).
- [librosa](https://github.com/librosa/librosa).
- [mir_eval](https://github.com/craffel/mir_eval).
- [Let It Bee](https://github.com/ctralie/LetItBee), referência histórica da tentativa de dicionário espectral.
- [Moppy2](https://github.com/samphonic/Moppy2), referência para motores musicais; não é solução de transcrição.

Esses links são pontos de partida conhecidos, não uma revisão bibliográfica realizada para este dossiê.

## 14. Proveniência e reprodução local, se o repositório for disponibilizado

Diretório original: `/home/gaok1/Pessoal/motor-orchestra`. Inicialização: `./run.sh`; endereço local `http://127.0.0.1:8001`. O script prepara a venv e as bibliotecas compartilhadas necessárias no ambiente NixOS. O Basic Pitch é instalado com `--no-deps` e usa ONNX; TensorFlow não faz parte do fluxo.

```bash
node --test tests/orchestra.test.mjs
./run.sh -m unittest discover -s tests -p 'test_*.py'
node scripts/benchmark-orchestral.mjs downloads/IpPIK4T068s/notes.json
node scripts/evaluate-arrangement.mjs notas.json gabarito.json alta
node scripts/benchmark-continuity.mjs downloads
node scripts/audit-arrangements.mjs downloads
```

O último comando pode ser demorado com muitos candidatos/configurações. Não é uma avaliação de fidelidade; verifica invariantes.

Dados de cada música: `downloads/<id>/audio.wav`, `notes.json`, `title.txt` e, em alguns casos, `source.webm`. Os arquivos em `/tmp/motor-orchestra-asgore` e `/tmp/motor-orchestra-megalovania` são artefatos exploratórios locais e temporários; não pressupor que acompanhem este Markdown.

Os apêndices seguintes incorporam dados e fontes centrais para diminuir essa dependência. Não incorporam os WAVs, os pesos ONNX, todos os caches completos nem uma partitura canônica inexistente. O inventário de caches é uma coleção informal de músicas escolhidas durante o desenvolvimento, não um dataset público curado.

## Apêndice A. Inventário dos caches disponíveis

Snapshot local do levantamento, não avaliação uniforme. A versão de análise pode variar por música; `—` indica que o cache não registrava a afinação. Nenhuma linha implica disponibilidade de partitura, stems ou licença de dataset. Os links identificam as gravações utilizadas, não garantem que outra cópia mantenha duração e afinação idênticas.


| ID / gravação | Título no cache | Duração (s) | Versão | Normal | Média | Alta | Compensação registrada (cents) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [wU7LNSTQWX8](https://www.youtube.com/watch?v=wU7LNSTQWX8) | "Celtic Hymn" on Tin Whistle in D--Original Composition | 185.562 | 8 | 1009 | 1178 | 1476 | — |
| [j42byy7G_Ow](https://www.youtube.com/watch?v=j42byy7G_Ow) | Anunciação | 288.160 | 9 | 2619 | 4171 | 5416 | — |
| [PJ1yqbr8Y50](https://www.youtube.com/watch?v=PJ1yqbr8Y50) | Bergentrückung + ASGORE by Toby Fox but I perfected the gap between the songs | 173.186 | 10 | 1781 | 2921 | 3850 | -38 |
| [AKAiUtWZ4xY](https://www.youtube.com/watch?v=AKAiUtWZ4xY) | Bonetrousle | 57.600 | 10 | 557 | 1175 | 1591 | -41 |
| [uiFpB1OsNTU](https://www.youtube.com/watch?v=uiFpB1OsNTU) | Carry On | 305.093 | 9 | 2252 | 4910 | 6788 | — |
| [Tjp8cj8Vzyo](https://www.youtube.com/watch?v=Tjp8cj8Vzyo) | Davy Jones | 195.240 | 8 | 855 | 1424 | 2271 | — |
| [Et3NQPnxtqY](https://www.youtube.com/watch?v=Et3NQPnxtqY) | DBZ Budokai 3 Opening (Instrumental) | 205.787 | 9 | 1667 | 2723 | 3582 | — |
| [8KkADVCERFc](https://www.youtube.com/watch?v=8KkADVCERFc) | Ed Sheeran - Nancy Mulligan (Instrumental) | 179.107 | 8 | 547 | 1169 | 2290 | — |
| [1Tz0qw-iLPU](https://www.youtube.com/watch?v=1Tz0qw-iLPU) | ELEIÇÕES 2026, FORA PT AQUI NÃO É SEU LUGAR, MÚSICA ELEIÇÕES BOLSONARO, 22 FLÁVIO BOLSONARO POLÍTICA | 180.094 | 8 | 177 | 686 | 1696 | — |
| [yT3ne1uq8iU](https://www.youtube.com/watch?v=yT3ne1uq8iU) | Falamansa - Rindo à Toa | 222.041 | 8 | 1864 | 2979 | 4254 | — |
| [CMiKdEpcreU](https://www.youtube.com/watch?v=CMiKdEpcreU) | Falamansa - Xote da Alegria | 255.803 | 9 | 2715 | 4311 | 5241 | — |
| [QvS34v0zmMU](https://www.youtube.com/watch?v=QvS34v0zmMU) | Falamansa - Xote da Alegria (Instrumental + backings vocals) Official | 255.919 | 8 | 2179 | 3377 | 4798 | — |
| [9emO9qo4FwE](https://www.youtube.com/watch?v=9emO9qo4FwE) | Freezing Moon | 383.053 | 8 | 225 | 1163 | 3369 | — |
| [X2DUpDxFJyg](https://www.youtube.com/watch?v=X2DUpDxFJyg) | Gravity Falls - Opening Theme Song - HD | 39.114 | 8 | 219 | 407 | 670 | — |
| [AxRGy80De04](https://www.youtube.com/watch?v=AxRGy80De04) | Gravity Falls Main Theme Official Instrumental - Gravity Falls Soundtrack | 40.670 | 8 | 271 | 445 | 673 | — |
| [ihD0QMj-eeo](https://www.youtube.com/watch?v=ihD0QMj-eeo) | Hikari no Sasu Mirai e! (Legendado) \| Dragon Ball Z Infinite World | 249.046 | 9 | 1775 | 3677 | 5129 | — |
| [-1pMMIe4hb4](https://www.youtube.com/watch?v=-1pMMIe4hb4) | Kate Bush - Wuthering Heights - Official Music Video - Version 1 | 225.431 | 9 | 1794 | 2811 | 3323 | — |
| [0FCvzsVlXpQ](https://www.youtube.com/watch?v=0FCvzsVlXpQ) | MEGALOVANIA | 156.000 | 10 | 1052 | 1805 | 2359 | 0 |
| [JLJl0P1s_L0](https://www.youtube.com/watch?v=JLJl0P1s_L0) | Naruto Shippuden: Ultimate Ninja Storm - 3 Ost (Seeking Answers) | 383.327 | 9 | 2217 | 3155 | 3983 | — |
| [tDU-G4o0XV8](https://www.youtube.com/watch?v=tDU-G4o0XV8) | Nova Era | 292.120 | 9 | 2270 | 4913 | 7246 | — |
| [GUPRVkhBtVA](https://www.youtube.com/watch?v=GUPRVkhBtVA) | Oh! Susanna - American Folk Song | 96.723 | 8 | 465 | 781 | 1195 | — |
| [dQw4w9WgXcQ](https://www.youtube.com/watch?v=dQw4w9WgXcQ) | Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster) | 213.043 | 8 | 1123 | 2813 | 4886 | — |
| [wAUmyjDtLtw](https://www.youtube.com/watch?v=wAUmyjDtLtw) | Rock Bones: Boys Dont Cry - Peter Punk | 191.077 | 8 | 1020 | 1715 | 2923 | — |
| [quxTnEEETbo](https://www.youtube.com/watch?v=quxTnEEETbo) | Rondo Alla Turca- Mozart | 208.887 | 9 | 2642 | 3290 | 3611 | — |
| [9t8TFGTAAoU](https://www.youtube.com/watch?v=9t8TFGTAAoU) | Sea of Thieves - (Becalmed)  Hurdy-Gurdy Instrument Soundtrack | 165.024 | 8 | 651 | 886 | 1314 | — |
| [IW9PlPTErKE](https://www.youtube.com/watch?v=IW9PlPTErKE) | Sea Of Thieves - Glitterbeard Easter-egg - Full Song, No CC | 167.230 | 8 | 1032 | 1397 | 1905 | — |
| [du8koxX1f-I](https://www.youtube.com/watch?v=du8koxX1f-I) | SEA SHANTY METAL - "Bully In The Alley" (Sea Shanty Collab) | 169.761 | 8 | 695 | 1499 | 2766 | — |
| [X791IzOwt3Q](https://www.youtube.com/watch?v=X791IzOwt3Q) | Stairway to Heaven (Remaster) | 485.013 | 10 | 3367 | 5019 | 6376 | 0 |
| [IpPIK4T068s](https://www.youtube.com/watch?v=IpPIK4T068s) | Test Drive (From How To Train Your Dragon Music From The Motion Picture) | 156.307 | 9 | 949 | 1757 | 2406 | — |
| [-RRWvHTQjPE](https://www.youtube.com/watch?v=-RRWvHTQjPE) | The Cruel Angel's Thesis \| Evangelion Finally | 252.378 | 9 | 1507 | 3150 | 4709 | — |
| [LACbVhgtx9I](https://www.youtube.com/watch?v=LACbVhgtx9I) | THE MUFFIN SONG (asdfmovie feat. Schmoyoho) | 201.050 | 9 | 1222 | 2331 | 3511 | — |
| [1lyu1KKwC74](https://www.youtube.com/watch?v=1lyu1KKwC74) | The Verve - Bitter Sweet Symphony | 275.412 | 10 | 1920 | 3615 | 4554 | 0 |
| [9MCiixIkzUk](https://www.youtube.com/watch?v=9MCiixIkzUk) | Toothless Dancing Meme [NEW VARIATIONS] | 214.552 | 8 | 1308 | 2696 | 4753 | — |
| [xfYoVrxHSfc](https://www.youtube.com/watch?v=xfYoVrxHSfc) | 【静止画MAD】戦闘民族サイヤ人──DRAGON BALL Z | 224.351 | 9 | 1476 | 2740 | 3817 | — |


São **34 caches** neste snapshot. A auditoria histórica de 32 caches ocorreu antes da incorporação de outras faixas; não a confundir com auditoria completa deste inventário.

## Apêndice B. Dados concretos de MEGALOVANIA

### B.1 Todos os candidatos da densidade alta com ataque antes de 8 s

Extração do cache versão 10, antes do filtro da interface. Cada linha conserva início, fim, MIDI e intensidade, com três casas decimais. As curvas finas foram omitidas para legibilidade. Não é partitura de referência.


| Início (s) | Fim (s) | MIDI | Intensidade |
| --- | --- | --- | --- |
| 0.012 | 0.197 | 69 | 0.172 |
| 0.035 | 0.209 | 86 | 0.151 |
| 0.058 | 0.441 | 62 | 0.372 |
| 0.128 | 0.279 | 50 | 0.396 |
| 0.174 | 0.383 | 81 | 0.157 |
| 0.499 | 0.685 | 57 | 0.506 |
| 0.499 | 0.639 | 76 | 0.158 |
| 0.871 | 1.057 | 56 | 0.493 |
| 1.126 | 1.312 | 55 | 0.481 |
| 1.126 | 1.265 | 74 | 0.189 |
| 1.382 | 1.614 | 65 | 0.151 |
| 1.382 | 1.614 | 72 | 0.159 |
| 1.428 | 1.753 | 53 | 0.400 |
| 1.428 | 1.567 | 81 | 0.158 |
| 1.579 | 1.741 | 62 | 0.141 |
| 1.625 | 1.776 | 50 | 0.384 |
| 1.753 | 1.904 | 53 | 0.438 |
| 1.881 | 2.033 | 55 | 0.471 |
| 1.892 | 2.207 | 67 | 0.169 |
| 2.045 | 2.219 | 84 | 0.168 |
| 2.056 | 2.242 | 60 | 0.161 |
| 2.068 | 2.265 | 48 | 0.324 |
| 2.242 | 2.428 | 62 | 0.531 |
| 2.497 | 2.683 | 57 | 0.505 |
| 2.497 | 2.637 | 76 | 0.158 |
| 2.869 | 3.055 | 56 | 0.494 |
| 3.124 | 3.322 | 55 | 0.466 |
| 3.124 | 3.264 | 74 | 0.190 |
| 3.380 | 3.751 | 53 | 0.422 |
| 3.391 | 3.635 | 72 | 0.176 |
| 3.415 | 3.566 | 81 | 0.156 |
| 3.426 | 3.624 | 65 | 0.157 |
| 3.589 | 3.751 | 62 | 0.145 |
| 3.635 | 3.775 | 50 | 0.369 |
| 3.751 | 3.902 | 53 | 0.438 |
| 3.879 | 4.031 | 55 | 0.457 |
| 3.996 | 4.275 | 47 | 0.318 |
| 4.008 | 4.194 | 66 | 0.163 |
| 4.054 | 4.194 | 83 | 0.144 |
| 4.066 | 4.205 | 59 | 0.163 |
| 4.171 | 4.380 | 81 | 0.150 |
| 4.240 | 4.426 | 62 | 0.530 |
| 4.496 | 4.681 | 57 | 0.503 |
| 4.496 | 4.635 | 76 | 0.158 |
| 4.879 | 5.018 | 75 | 0.192 |
| 4.925 | 5.065 | 56 | 0.465 |
| 5.123 | 5.320 | 55 | 0.468 |
| 5.134 | 5.285 | 74 | 0.207 |
| 5.378 | 5.750 | 53 | 0.423 |
| 5.390 | 5.866 | 72 | 0.161 |
| 5.413 | 5.564 | 81 | 0.156 |
| 5.424 | 5.622 | 65 | 0.157 |
| 5.587 | 5.750 | 62 | 0.145 |
| 5.633 | 5.773 | 50 | 0.368 |
| 5.750 | 5.900 | 53 | 0.446 |
| 5.877 | 6.029 | 55 | 0.455 |
| 5.947 | 6.099 | 58 | 0.127 |
| 5.995 | 6.273 | 46 | 0.308 |
| 6.006 | 6.180 | 65 | 0.152 |
| 6.053 | 6.192 | 82 | 0.150 |
| 6.238 | 6.424 | 62 | 0.531 |
| 6.494 | 6.691 | 57 | 0.499 |
| 6.494 | 6.645 | 76 | 0.168 |
| 6.877 | 7.016 | 75 | 0.197 |
| 6.923 | 7.063 | 56 | 0.463 |
| 7.121 | 7.318 | 55 | 0.468 |
| 7.132 | 7.283 | 74 | 0.208 |
| 7.376 | 7.748 | 53 | 0.436 |
| 7.388 | 7.620 | 72 | 0.171 |
| 7.411 | 7.574 | 81 | 0.156 |
| 7.423 | 7.620 | 65 | 0.157 |
| 7.585 | 7.748 | 62 | 0.143 |
| 7.632 | 7.771 | 50 | 0.374 |
| 7.748 | 7.899 | 53 | 0.441 |
| 7.875 | 8.016 | 55 | 0.446 |
| 7.910 | 8.353 | 86 | 0.137 |
| 7.981 | 8.260 | 50 | 0.274 |
| 7.993 | 8.179 | 69 | 0.168 |


### B.2 Primeira voz do arranjador anterior

Configuração da comparação congelada da seção 7. Eventos com ataque antes de 8 s; os fins são os do arranjo e podem incluir legato.


| Início (s) | Fim (s) | MIDI |
| --- | --- | --- |
| 0.058 | 0.441 | 62 |
| 1.126 | 1.265 | 74 |
| 1.382 | 1.614 | 72 |
| 1.892 | 2.242 | 67 |
| 2.242 | 2.428 | 62 |
| 3.124 | 3.264 | 74 |
| 3.391 | 3.635 | 72 |
| 4.240 | 4.426 | 62 |
| 5.134 | 5.285 | 74 |
| 5.390 | 5.866 | 72 |
| 6.006 | 6.238 | 65 |
| 6.238 | 6.424 | 62 |
| 7.132 | 7.283 | 74 |


### B.3 Primeira voz do experimento atual

Configuração da comparação congelada da seção 7. Eventos com ataque antes de 8 s; os fins são os do arranjo e podem incluir legato.


| Início (s) | Fim (s) | MIDI |
| --- | --- | --- |
| 0.058 | 0.499 | 62 |
| 0.499 | 0.685 | 57 |
| 0.871 | 1.126 | 56 |
| 1.126 | 1.312 | 55 |
| 1.428 | 1.753 | 53 |
| 1.753 | 1.881 | 53 |
| 1.881 | 2.056 | 55 |
| 2.056 | 2.242 | 60 |
| 2.242 | 2.497 | 62 |
| 2.497 | 2.683 | 57 |
| 2.869 | 3.124 | 56 |
| 3.124 | 3.380 | 55 |
| 3.380 | 3.751 | 53 |
| 3.751 | 3.879 | 53 |
| 3.879 | 4.066 | 55 |
| 4.066 | 4.240 | 59 |
| 4.240 | 4.426 | 62 |
| 5.134 | 5.285 | 74 |
| 6.006 | 6.238 | 65 |
| 6.238 | 6.424 | 62 |
| 7.132 | 7.283 | 74 |


## Apêndice C. Fonte completa atual da transcrição

`transcribe.py`, incorporado para reproduzir limiares, união de fragmentos, normalização de afinação e curvas. O texto é o código do levantamento, não pseudocódigo nem uma proposta nova. Depende de Basic Pitch e do ambiente listado no apêndice F.


```python
"""Transcrição polifônica com o basic-pitch (Spotify), rodando localmente via ONNX.

O modelo devolve eventos de nota (início, fim, altura MIDI, intensidade, curva fina de
afinação). A saída da rede é convertida em notas com três níveis de densidade: limiares mais
baixos aceitam notas mais fracas, o que dá material aos motores extras. O arranjo é feito no
navegador (score.mjs).
"""

import logging
from contextlib import contextmanager
from tempfile import NamedTemporaryFile

import numpy as np

# Faixa útil para os motores: Si0 (~31 Hz) até ~Dó8.
MIN_FREQ = 30.0
MAX_FREQ = 4200.0
# (limiar de ataque, limiar de quadro) do basic-pitch; "normal" é o padrão da biblioteca.
DENSITIES = {"normal": (0.5, 0.3), "media": (0.35, 0.2), "alta": (0.25, 0.15)}


def _tuning_offset(audio, sr):
    """Desvio global em semitons, só quando os picos têm afinação coerente.

    Um sinal entre dois semitons espalha a ativação da rede por duas notas e
    corta sustentações. Usa até 40 s distribuídos pela faixa; vibrato, ruído e
    instrumentos inarmônicos não devem impor uma correção global arbitrária.
    """
    import librosa

    size = 8 * sr
    if len(audio) > 5 * size:
        starts = np.linspace(0, len(audio) - size, 5, dtype=int)
        audio = np.concatenate([audio[start:start + size] for start in starts])
    pitches, magnitudes = librosa.piptrack(
        y=audio, sr=sr, n_fft=4096, hop_length=1024,
        fmin=150, fmax=4000, threshold=0.3,
    )
    mask = pitches > 0
    if not mask.any():
        return 0.0
    mask &= magnitudes >= np.median(magnitudes[mask])
    frequencies, weights = pitches[mask], magnitudes[mask]
    tuning = float(librosa.pitch_tuning(frequencies, resolution=0.01))
    residual = (librosa.hz_to_midi(frequencies) - tuning + 0.5) % 1 - 0.5
    concentration = weights[np.abs(residual) < 0.1].sum() / weights.sum()
    return tuning if abs(tuning) >= 0.15 and concentration >= 0.5 else 0.0


@contextmanager
def _inference_input(wav_path):
    """Afina apenas a entrada da rede; devolve a escala dos tempos originais.

    Trocar a taxa do WAV temporário muda altura e duração juntas, sem vocoder.
    Os tempos detectados são multiplicados pela mesma razão para acompanhar o
    áudio original. O arquivo baixado nunca é alterado.
    """
    import librosa
    import soundfile as sf

    audio, sr = librosa.load(wav_path, sr=22050, mono=True)
    tuning = _tuning_offset(audio, sr)
    if not tuning:
        yield wav_path, 1.0, 0.0
        return
    corrected_sr = round(sr * 2 ** (-tuning / 12))
    with NamedTemporaryFile(suffix=".wav", prefix="orchestra-tuned-") as temporary:
        sf.write(temporary.name, audio, corrected_sr, subtype="FLOAT")
        yield temporary.name, corrected_sr / sr, tuning


def _fine_curve(contours, s, e, midi, half=4):
    """Afinação fina da nota, em semitons, quadro a quadro: centróide de 3 bins em volta do pico do
    contorno (3 bins por semitom), numa janela de ±4 bins (±1,3 semitom) em volta da nota. O
    get_pitch_bends do basic-pitch usa argmax (degraus de 1/3 de semitom) numa janela de ±8
    semitons, que pega o contorno de notas vizinhas. Quadros com contorno fraco ficam NaN."""
    center = 3 * (midi - 21)                     # bin k ↔ 27,5·2^(k/36) Hz; Lá0 = MIDI 21
    lo, hi = max(0, center - half), min(contours.shape[1], center + half + 1)
    w = contours[s:e, lo:hi]
    if w.size == 0:
        return None
    pk = w.argmax(axis=1)
    rows = np.arange(len(pk))
    left = w[rows, np.maximum(pk - 1, 0)]
    mid = w[rows, pk]
    right = w[rows, np.minimum(pk + 1, w.shape[1] - 1)]
    curve = (lo + pk + (right - left) / (left + mid + right + 1e-9) - center) / 3.0
    curve[mid <= 0.1] = np.nan
    return curve


def _bends(curve, bias):
    """Tira o desvio fixo da música (viés do modelo + afinação da gravação), preenche quadros
    fracos, suaviza, guarda um valor a cada 2 quadros (~43 Hz) e omite notas sem variação."""
    if curve is None or np.isnan(curve).all():
        return None
    from scipy.signal import medfilt

    b = curve - bias
    idx = np.arange(len(b))
    ok = ~np.isnan(b)
    b = np.interp(idx, idx[ok], b[ok])
    if len(b) >= 3:
        b = medfilt(b, 3)
        b = np.convolve(np.pad(b, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    b = np.clip(b, -1.5, 1.5)[::2]
    if np.abs(b).max() < 0.08:
        return None
    return [round(float(x), 2) for x in b]


# O basic-pitch quebra notas contínuas em pedaços colados da mesma altura. No gabarito sintético
# (sem nenhuma nota repetida colada) 67% das notas saíram assim. A força do ataque que a própria
# rede estima separa bem: re-ataques reais 0,81–0,94, quebras falsas 0,37–0,67. Abaixo de 0,7
# os pedaços são juntados (93% das quebras falsas, 4% dos re-ataques reais).
SPLIT_MAX_GAP = 3        # quadros (~35 ms) entre os pedaços
SPLIT_MAX_ONSET = 0.7


def _merge_splits(notes, onsets, frames=None):
    by_pitch = {}
    for s, e, pitch, amp in notes:
        by_pitch.setdefault(pitch, []).append([s, e, pitch, amp])
    merged = []
    for pitch, run in by_pitch.items():
        run.sort()
        cur = run[0]
        for nxt in run[1:]:
            attack = onsets[max(0, nxt[0] - 1):nxt[0] + 2, pitch - 21].max()
            # Um novo ataque moderado após uma queda real de energia é uma
            # repetição, mesmo abaixo de 0,7. Não apaga articulação de notas suaves.
            valley = False
            if frames is not None and attack >= 0.35:
                boundary = frames[max(cur[0], nxt[0] - 3):nxt[0] + 1, pitch - 21]
                valley = boundary.size > 0 and boundary.min() < 0.5 * min(cur[3], nxt[3])
            if nxt[0] - cur[1] <= SPLIT_MAX_GAP and attack < SPLIT_MAX_ONSET and not valley:
                # Intensidade média, não o máximo de um fragmento: evita promover
                # uma sustentação fraca só porque um pedaço saiu mais forte.
                end = max(cur[1], nxt[1])
                amp = float(frames[cur[0]:end, pitch - 21].mean()) if frames is not None else max(cur[3], nxt[3])
                cur = [cur[0], end, pitch, amp]
            else:
                merged.append(cur)
                cur = nxt
        merged.append(cur)
    return merged


def _decode_notes(output, onset, frame):
    """Mantém a decodificação longa e recupera notas curtas com ataque explícito.

    Baixar o mínimo global também aceitaria resíduos sem ataque. A segunda
    passagem exige ataque explícito (>=0,35), energia >=0,2 e respeita os limiares
    mais altos das outras densidades. Não usa o resíduo melodia_trick.
    Não substitui nem recorta eventos já encontrados pela passagem normal.
    """
    from basic_pitch.note_creation import output_to_notes_polyphonic

    def decode(**options):
        # constrain_frequency da biblioteca altera seus argumentos in-place.
        return output_to_notes_polyphonic(
            output["note"].copy(), output["onset"].copy(),
            max_freq=MAX_FREQ, min_freq=MIN_FREQ, **options,
        )

    notes = decode(onset_thresh=onset, frame_thresh=frame, min_note_len=11,
                   infer_onsets=True, melodia_trick=True)
    short = decode(onset_thresh=max(0.35, onset), frame_thresh=max(0.2, frame),
                   min_note_len=4, energy_tol=3, infer_onsets=False, melodia_trick=False)
    by_pitch = {}
    for n in notes:
        by_pitch.setdefault(n[2], []).append(n)
    for s, e, pitch, amp in short:
        if e - s > 11 or amp < max(0.2, frame):
            continue
        existing = by_pitch.setdefault(pitch, [])
        if any(s < b and e > a for a, b, *_ in existing):
            continue
        note = (s, e, pitch, amp)
        notes.append(note)
        existing.append(note)
    return _merge_splits(notes, output["onset"], output["note"])


def transcribe(wav_path):
    # O basic-pitch avisa ao importar que TensorFlow/CoreML/TFLite não estão instalados;
    # aqui só usamos o backend ONNX, então os avisos são ruído.
    logging.disable(logging.WARNING)
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model, predict
        from basic_pitch.note_creation import model_frames_to_time
    finally:
        logging.disable(logging.NOTSET)

    import librosa

    with _inference_input(wav_path) as (input_path, time_scale, tuning):
        output, _, _ = predict(
            str(input_path), Model(ICASSP_2022_MODEL_PATH),
            minimum_frequency=MIN_FREQ, maximum_frequency=MAX_FREQ,
        )
    contours = output["contour"]
    times = model_frames_to_time(contours.shape[0]) * time_scale
    raw = {}
    for name, (onset, frame) in DENSITIES.items():
        # mesmos passos de basic_pitch.note_creation.model_output_to_notes, mas com os índices
        # de quadro, para calcular a curva fina de afinação de cada nota
        notes = _decode_notes(output, onset, frame)
        raw[name] = [
            (s, e, int(pitch), float(amp), _fine_curve(contours, s, e, int(pitch)))
            for s, e, pitch, amp in notes
        ]
    # Desvio fixo: mediana da afinação das notas. No gabarito sintético (afinado em Lá 440) o
    # basic-pitch dá +0,31 semitom em todas as notas: é viés do modelo, não da música.
    medians = [np.nanmedian(c) for *_, c in raw["media"] if c is not None and not np.isnan(c).all()]
    bias = float(np.median(medians)) if medians else 0.0
    density = {}
    for name, notes in raw.items():
        # [início, fim, midi, intensidade, curva de afinação ou None]
        density[name] = sorted(
            ([round(float(times[s]), 3), round(float(times[e]), 3), pitch, round(amp, 3), _bends(curve, bias)]
             for s, e, pitch, amp, curve in notes),
            key=lambda n: (n[0], n[2]),
        )
    return {
        "duration": float(librosa.get_duration(path=str(wav_path))),
        "tuning_cents": round(tuning * 100, 1),
        "notes": density.pop("normal"),
        "density": density,
    }
```

## Apêndice D. Fonte completa atual da partitura e do arranjador

`score.mjs`, incluindo as demonstrações e funções auxiliares para que o arquivo possa ser reconstruído como módulo independente. **A parte de relações harmônicas contém o experimento incompleto descrito no texto.** Copiar esta fonte não transforma o experimento em solução validada.


```javascript
// Partituras da orquestra: afinação, demonstrações e arranjo da transcrição em vozes.
// Uma partitura é { title, duration, tracks }, onde tracks[i] é a voz do motor i:
// lista ordenada de { midi, start, end, vel } sem sobreposição (um motor = uma nota).

const NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

export const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const noteName = (midi) => { const m = Math.round(midi); return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`; };

// Nota tocada pela voz no instante t (segundos de partitura), ou null.
export function noteAt(track, t) {
  let lo = 0, hi = track.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, note = track[mid];
    if (t < note.start) hi = mid - 1;
    else if (t >= note.end) lo = mid + 1;
    else return note;
  }
  return null;
}

// Partitura em texto: uma linha por motor. Tokens: `A4`, `C#5:0.5` (nota:tempos),
// `-` ou `-:2` (pausa), `@0.5` (duração padrão), `v0.6` (intensidade), `|` (barra, ignorada).
// Linhas que começam com `#` são comentários.
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS = { '': 0, '#': 1, '♯': 1, b: -1, '♭': -1 };

export function parseNote(token) {
  const match = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(token);
  if (!match) return null;
  const midi = (Number(match[3]) + 1) * 12 + LETTERS[match[1].toUpperCase()] + ACCIDENTALS[match[2]];
  return midi >= 0 && midi <= 127 ? midi : null;
}

export function parseScore(text, bpm) {
  const beat = 60 / bpm, gap = 0.08;
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const tracks = lines.map((source, row) => {
    let t = 0, unit = 1, vel = 0.85;
    const notes = [];
    for (const token of source.split(/\s+/)) {
      if (token === '|') continue;
      if (/^@[\d.]+$/.test(token)) { unit = Number(token.slice(1)); continue; }
      if (/^v[\d.]+$/.test(token)) { vel = Math.min(1, Number(token.slice(1))); continue; }
      const [head, beats = String(unit)] = token.split(':');
      const dur = Number(beats) * beat;
      if (!(dur > 0)) throw new Error(`Motor ${row + 1}: duração inválida em “${token}”.`);
      if (head !== '-') {
        const midi = parseNote(head);
        if (midi === null) throw new Error(`Motor ${row + 1}: nota inválida “${head}” (use A4, C#5, Bb3...).`);
        notes.push({ midi, start: t, end: t + dur * (1 - gap), vel });
      }
      t += dur;
    }
    return notes;
  });
  return { tracks, duration: Math.max(0, ...tracks.flat().map((n) => n.end)) + 0.3 };
}

export const DEMOS = {
  scale: {
    title: 'Escala de Lá maior (sobe e desce)', bpm: 150,
    text: 'A4 B4 C#5 D5 E5 F#5 G#5 A5 | G#5 F#5 E5 D5 C#5 B4 A4:2',
  },
  chords: {
    title: 'Acordes I–V–vi–IV em Lá maior', bpm: 120,
    text: [
      '@4 A4 G#4 A4 A4 | A4 G#4 A4 A4 | A4:6',
      '@4 C#5 B4 C#5 D5 | C#5 B4 C#5 D5 | C#5:6',
      '@4 E5 E5 F#5 F#5 | E5 E5 F#5 F#5 | E5:6',
      'v1 @4 A2 E2 F#2 D2 | A2 E2 F#2 D2 | A2:6',
    ].join('\n'),
  },
  original: {
    title: 'Engrenagens (composição original)', bpm: 132,
    text: [
      '# melodia',
      'v0.95 E5 A5 G5:.5 E5:.5 C5 | D5:1.5 C5:.5 A4:2 | E5 G5 C6 B5:.5 A5:.5 | B5:2 G5 D5 | A5:.5 G5:.5 E5 A5 C6 | A5:1.5 G5:.5 F5 E5 | D5 G5 B5 D6 | A5:4',
      '# arpejo',
      'v0.6 @.5 A3 C4 E4 C4 A3 C4 E4 C4 | F3 A3 C4 A3 F3 A3 C4 A3 | G3 C4 E4 C4 G3 C4 E4 C4 | G3 B3 D4 B3 G3 B3 D4 B3 | A3 C4 E4 C4 A3 C4 E4 C4 | F3 A3 C4 A3 F3 A3 C4 A3 | G3 B3 D4 B3 G3 B3 D4 B3 | A3:4',
      '# baixo',
      'v0.9 A2 A3 A2 E3 | F2 F3 F2 C3 | C3 C4 C3 G3 | G2 G3 G2 D3 | A2 A3 A2 E3 | F2 F3 F2 C3 | G2 G3 G2 D3 | A2:4',
      '# sustentação',
      'v0.5 @4 C5 | A4 | G4 | B4 | C5 | A4 | B4 | A4',
    ].join('\n'),
  },
};

// ---------- Arranjo de uma transcrição para N motores ----------
// `job.notes` vem do transcritor: [início, fim, midi, intensidade 0..1].
// Papéis, como num arranjo para floppies (Moppy): motor 1 = melodia, último = baixo,
// os do meio = harmonia. Cada motor toca uma nota por vez.

export const MELODY_RANGE = [52, 90];  // Mi3 a Fá♯6
export const BASS_TOP = 55;           // até Sol3
const MIN_FRAGMENT = 0.05;            // trechos menores que isso viram ruído
const REATTACK = 0.03;                // notas da mesma altura a menos disso viram re-ataque sem parar o motor
// O transcritor acerta o ataque (~3 ms) mas erra o fim das notas em até ~100 ms; sem
// este bônus, a cauda da nota anterior ainda "ganha" da nota que acabou de entrar.
const FRESH_BONUS = 12, FRESH_WINDOW = 0.25;

// Extrai uma linha monofônica: em cada intervalo entre bordas de notas, fica a nota
// ativa de maior `rank`. Notas usadas saem de `used`, para não tocarem duas vezes.
function extractLine(notes, rank, eligible, used) {
  const pool = notes.filter((n) => !used.has(n) && eligible(n)).sort((a, b) => a.start - b.start);
  const times = [...new Set(pool.flatMap((n) => [n.start, n.end]))].sort((a, b) => a - b);
  const pieces = [];
  let active = [], next = 0;
  for (let k = 0; k < times.length - 1; k++) {
    const t = times[k];
    while (next < pool.length && pool[next].start <= t) active.push(pool[next++]);
    active = active.filter((n) => n.end > t);
    if (!active.length) continue;
    const best = active.reduce((a, b) => (rank(b, t) > rank(a, t) ? b : a));
    const last = pieces.at(-1);
    if (last && last.note === best && last.end === t) last.end = times[k + 1];
    else pieces.push({ note: best, start: t, end: times[k + 1] });
  }
  const line = [];
  for (const piece of pieces) {
    if (piece.end - piece.start < MIN_FRAGMENT) continue;
    used.add(piece.note);
    line.push({ midi: piece.note.midi, start: piece.start, end: piece.end, vel: piece.note.vel });
  }
  return line;
}

// Harmonia: notas restantes, em ordem de ataque, para o motor livre de nota mais
// próxima. Sem motor livre, rouba o que já soou por mais tempo (o ataque novo
// importa mais que a cauda de uma nota longa).
function fillHarmony(notes, count, busy) {
  const tracks = Array.from({ length: count }, () => []);
  if (!count) return tracks;
  const sounding = (midi, t) => busy.some((track) => track.some((n) => n.midi === midi && n.start <= t && n.end > t));
  for (const note of notes.slice().sort((a, b) => a.start - b.start || b.vel - a.vel)) {
    if (sounding(note.midi, note.start + 0.01)) continue; // já está na melodia ou no baixo
    let best = -1, cost = Infinity;
    tracks.forEach((track, m) => {
      const last = track.at(-1);
      if (last && last.end > note.start) return;
      const c = last ? Math.abs(last.midi - note.midi) : 0;
      if (c < cost) { best = m; cost = c; }
    });
    if (best < 0) {
      let oldest = Infinity;
      tracks.forEach((track, m) => {
        const last = track.at(-1);
        if (note.start - last.start >= 0.12 && note.vel >= last.vel * 0.7 && last.start < oldest) { best = m; oldest = last.start; }
      });
      if (best < 0) continue;
      tracks[best].at(-1).end = note.start;
    }
    tracks[best].push({ midi: note.midi, start: note.start, end: note.end, vel: note.vel });
  }
  return tracks;
}

// Garante uma nota por vez por motor. Nota repetida colada vira re-ataque: o motor não para (parar
// e reacelerar soa como um "vai e volta" na altura); o engine só dá uma piscada no volume.
function articulate(track) {
  track.sort((a, b) => a.start - b.start);
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    a.end = Math.min(a.end, b.start);
    if (a.midi === b.midi && b.start - a.end < REATTACK) {
      a.end = b.start;
      b.reattack = true;
    }
  }
  return track.filter((n) => n.end - n.start >= 0.03);
}

export function arrange(job, motors, { threshold = 0.3 } = {}) {
  const notes = job.notes
    .filter(([, , , amp]) => amp >= threshold)
    .map(([start, end, midi, amp]) => ({ start, end, midi, vel: Math.min(1, 0.4 + 0.8 * amp) }));
  const used = new Set();
  const fresh = (n, t) => (t - n.start < FRESH_WINDOW ? FRESH_BONUS : 0);
  const melody = motors >= 1
    ? extractLine(notes, (n, t) => n.midi + 18 * n.vel + fresh(n, t), (n) => n.midi >= MELODY_RANGE[0] && n.midi <= MELODY_RANGE[1], used) : [];
  const bass = motors >= 2 ? extractLine(notes, (n, t) => -n.midi + 10 * n.vel + fresh(n, t), (n) => n.midi <= BASS_TOP, used) : [];
  const harmony = fillHarmony(notes.filter((n) => !used.has(n)), Math.max(0, motors - 2), [melody, bass]);
  const tracks = [melody, ...harmony, ...(motors >= 2 ? [bass] : [])].slice(0, motors).map(articulate);
  const roles = tracks.map((_, i) => (i === 0 ? 'melodia' : motors >= 2 && i === motors - 1 ? 'baixo' : 'harmonia'));
  return { title: job.title, tracks, roles, duration: job.duration };
}

// ---------- Linhas dinâmicas ----------
// Sem papéis fixos: o motor 1 pega a cadeia de notas de maior valor na música inteira, o motor 2
// a melhor cadeia entre as notas que sobraram, e assim por diante. O valor de uma cadeia é
// intensidade × tempo tocado, menos custos de salto grande e de interromper uma nota que ainda
// soaria (programação dinâmica sobre as notas). Cada ataque do motor é um ataque real da música.

const LINE = {
  base: 1, velW: 2,             // valor por segundo: base + velW·(intensidade − 0,7)
  tail: 0.1,                    // o transcritor erra o fim em até ~100 ms: cortar até aí é livre
  intC: 0.25, intK: 1,          // custo de interromper: fixo + por segundo que ainda soaria
  jumpC: 0.4, jump0: 7,         // custo por oitava de salto além de uma quinta
  phrase: 0.5,                  // depois de 0,5 s de silêncio, a frase recomeça sem custos
  noteC: 0.02, minPlay: 0.08,   // antes de interromper uma nota longa, deixa tocar 80 ms
};
const LEGATO = 0.12;            // buracos menores que isso na linha são preenchidos

// Um harmônico pode decair antes da fundamental ou unir dois re-ataques dela.
// A evidência é o ataque próximo e a cobertura da mesma altura, não fins iguais.
function harmonicCoverage(upper, interval, notes) {
  let aligned = false, covered = 0;
  for (const lower of notes) {
    if (lower.midi !== upper.midi - interval || lower.strength <= upper.strength * 1.1) continue;
    aligned ||= Math.abs(lower.start - upper.start) <= 0.06;
    covered += Math.max(0, Math.min(lower.end, upper.end) - Math.max(lower.start, upper.start));
  }
  return aligned ? Math.min(1, covered / (upper.end - upper.start)) : 0;
}

function bestChain(pool, priority = () => 1, p = LINE) {
  const N = pool.length;
  if (!N) return { chain: [], total: 0 };
  const rate = pool.map((n) => n.weight * priority(n));
  const F = new Float64Array(N), from = new Int32Array(N).fill(-1);
  const byEnd = [...pool.keys()].sort((a, b) => pool[a].end - pool[b].end);
  const active = new Set();
  let ptr = 0, closedBest = 0, closedArg = -1;
  for (let j = 0; j < N; j++) {
    const nj = pool[j];
    // cadeias cuja última nota acabou há mais de `phrase` s: sem custo de transição
    while (ptr < N && pool[byEnd[ptr]].end + p.phrase <= nj.start) {
      const i = byEnd[ptr++];
      active.delete(i);
      const v = F[i] + rate[i] * (pool[i].end - pool[i].start);
      if (v > closedBest) { closedBest = v; closedArg = i; }
    }
    let best = closedBest, arg = closedArg;
    // Só notas ainda próximas da frase; sustentações longas não desaparecem
    // por causa de uma janela fixa medida a partir do ataque.
    for (const i of active) {
      const ni = pool[i];
      // Uma nota curta completa pode levar à próxima: 80 ms é proteção contra
      // cortes prematuros, não um limite de andamento para trinados/arpejos.
      const minPlay = Math.min(p.minPlay, ni.end - ni.start);
      if (nj.start - ni.start + 1e-9 < minPlay) continue;
      let v = F[i] + rate[i] * (Math.min(ni.end, nj.start) - ni.start) - p.noteC;
      const rest = ni.end - nj.start;
      if (rest > p.tail) v -= p.intC + p.intK * (rest - p.tail);
      const leap = Math.abs(ni.midi - nj.midi);
      if (leap > p.jump0) v -= (p.jumpC * (leap - p.jump0)) / 12;
      if (v > best) { best = v; arg = i; }
    }
    F[j] = best;
    from[j] = arg;
    active.add(j);
  }
  let end = -1, total = 0;
  for (let j = 0; j < N; j++) {
    const v = F[j] + rate[j] * (pool[j].end - pool[j].start);
    if (v > total) { total = v; end = j; }
  }
  const chain = [];
  for (let j = end; j >= 0; j = from[j]) chain.push(pool[j]);
  return { chain: chain.reverse(), total };
}

// Registro relativo à textura local, sem faixa MIDI fixa. Só vizinhas com
// evidência suficiente votam: um harmônico agudo muito fraco não define o topo.
// A janela acompanha mudanças de registro e considera notas longas ainda ativas.
function melodyPriorities(pool) {
  const priorities = new Map(), active = new Set();
  let next = 0;
  for (const n of pool) {
    const t = n.start;
    while (next < pool.length && pool[next].start <= t + 0.5) active.add(pool[next++]);
    for (const other of active) if (other.end < t - 0.5) active.delete(other);
    let strongest = 0;
    for (const other of active) strongest = Math.max(strongest, other.strength);
    const floor = Math.max(0.18, strongest * 0.5);
    let below = 0, total = 0, pitchSum = 0, harmonicShadow = 1;
    let previous = 0, following = 0, competing = false;
    let prevNote = null, nextNote = null;
    for (const other of active) {
      if (other === n || other.strength < Math.max(0.12, n.strength * 0.6)) continue;
      const proximity = Math.max(0, 1 - Math.abs(n.midi - other.midi) / 7);
      if (other.start < n.start && Math.abs(other.end - n.start) <= 0.18 && proximity > previous) {
        previous = proximity;
        prevNote = other;
      }
      if (other.start > n.start && Math.abs(other.start - n.end) <= 0.18 && proximity > following) {
        following = proximity;
        nextNote = other;
      }
    }
    const relations = new Map();
    const relation = interval => {
      if (!relations.has(interval)) {
        const neighbors = [prevNote, nextNote].filter(Boolean);
        const paired = neighbor => harmonicCoverage(neighbor, interval, active) >= 0.7;
        relations.set(interval, {
          independent: neighbors.some(neighbor => !paired(neighbor)),
          parallel: neighbors.some(neighbor => neighbor.midi !== n.midi && paired(neighbor)),
        });
      }
      return relations.get(interval);
    };
    for (const other of active) {
      const interval = n.midi - other.midi;
      const octave = interval >= 12 && interval % 12 === 0;
      const overlap = Math.max(0, Math.min(n.end, other.end) - Math.max(n.start, other.start));
      const overtoneInterval = [19, 28, 31].includes(interval);
      const coverage = overtoneInterval ? harmonicCoverage(n, interval, active) : 0;
      // 3º, 5º e 6º harmônicos arredondados ao semitom. Exige coincidência
      // de ataques. Caudas diferentes também são aceitas se a frase vizinha
      // acompanha a mesma fundamental: o harmônico pode decair antes dela.
      const overtone = overtoneInterval && n.strength < other.strength * 0.75
        && Math.abs(other.start - n.start) <= 0.06
        && (Math.abs(other.end - n.end) <= 0.08 || coverage >= 0.7
          && relation(interval).parallel && !relation(interval).independent);
      if ((octave || overtone) && other.strength > n.strength * 1.1
          && Math.abs(other.start - n.start) <= 0.25 && Math.abs(other.end - n.end) <= 0.25) {
        // Coincidir com um harmônico numa nota do acorde não torna a frase
        // inteira um harmônico. Se a vizinha aguda se move independentemente
        // da voz grave, conserva a nota na linha melódica.
        const { independent } = relation(interval);
        // Uma cópia mais fraca, com ataque e fim próximos, pode ser um harmônico
        // do transcritor ou um dobramento. Prefere a oitava com mais evidência.
        if (!independent) harmonicShadow = Math.min(harmonicShadow, 1 - (overtone ? 0.97 * coverage : 0.85 * overlap / (n.end - n.start)));
      }
      if (other !== n && other.strength >= floor && other.start <= n.start && other.end >= n.end && interval > 7) competing = true;
      if (other.strength < floor) continue;
      const evidence = other.strength * Math.min(1, other.end - other.start);
      total += evidence;
      pitchSum += evidence * other.midi;
      if (other.midi < n.midi) below += evidence;
      else if (other.midi === n.midi) below += evidence * 0.5;
    }
    const rank = total ? below / total : 0.5;
    const center = total ? pitchSum / total : n.midi;
    // Só o percentil comprime as distâncias num acorde muito cheio: a melodia
    // uma oitava acima precisa se distinguir da nota superior da sustentação.
    const register = 2 ** Math.max(-2, Math.min(2, (n.midi - center) / 12));
    const reliable = Math.min(1, n.strength / floor);
    // O acompanhamento forte não pode fazer uma frase aguda suave parecer
    // vários picos isolados. Vizinhas de intensidade semelhante sustentam a
    // evidência da frase, mesmo abaixo do piso usado para estimar o registro.
    const support = Math.max(previous, following);
    let phraseStrength = n.strength;
    for (const other of active) if (Math.abs(other.midi - n.midi) <= 7) {
      phraseStrength = Math.max(phraseStrength, other.strength);
    }
    const phraseConfidence = Math.min(1, n.strength / Math.max(0.18, phraseStrength * 0.5));
    const confidence = reliable ** 4 * (1 - support) + phraseConfidence * support;
    // Um pico agudo curto isolado não deve cortar uma frase sustentada.
    // Uma sequência rápida com vizinhas próximas conserva sua prioridade.
    const continuity = competing && n.end - n.start < 0.3 ? 0.15 + 0.85 * support : 1;
    priorities.set(n, (0.15 + 3.85 * rank ** 3 * register * confidence) * harmonicShadow * continuity);
  }
  return priorities;
}

// Dobramentos em oitavas com o mesmo ataque têm menos valor depois de já
// representados. Não apaga notas nem penaliza uma linha independente só por
// compartilhar a classe de altura. O baixo continua concorrendo sem esse desconto.
function octaveRedundancy(note, tracks) {
  let overlap = 0;
  for (const track of tracks) {
    let lo = 0, hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track[mid].start < note.start - 0.08) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < track.length && track[i].start <= note.start + 0.08; i++) {
      const sounding = track[i];
      if (sounding.midi === note.midi || (sounding.midi - note.midi) % 12 !== 0) continue;
      overlap = Math.max(overlap, Math.max(0, Math.min(sounding.end, note.end)
        - Math.max(sounding.start, note.start)) / (note.end - note.start));
    }
  }
  return 1 - 0.65 * overlap;
}

// Notas da linha que soam entre `start` e `end`. As notas de uma linha não se
// sobrepõem, então os fins também estão em ordem crescente.
function overlapping(track, start, end) {
  let lo = 0, hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < track.length && track[i].start < end; i++) out.push(track[i]);
  return out;
}

// Acompanhamento pela função no acorde: a classe de altura que já soa em outra
// linha vale o mesmo que um dobramento (35%), durante a sobreposição, mesmo
// sem ataque simultâneo. O trecho novo ganha mais se for terça ou sétima acima
// da voz mais grave, que definem o acorde; a quinta e o uníssono não ganham.
function chordRole(note, tracks) {
  const spans = [], mid = (note.start + note.end) / 2;
  let bass = null;
  for (const track of tracks) for (const other of overlapping(track, note.start, note.end)) {
    if ((other.midi - note.midi) % 12 === 0) spans.push([Math.max(other.start, note.start), Math.min(other.end, note.end)]);
    if (other.start <= mid && other.end > mid && (!bass || other.midi < bass.midi)) bass = other;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let covered = 0, from = note.start, to = note.start;
  for (const [a, b] of spans) {
    if (a > to) { covered += to - from; from = a; to = b; }
    else to = Math.max(to, b);
  }
  covered = (covered + to - from) / (note.end - note.start);
  const interval = bass ? (((note.midi - bass.midi) % 12) + 12) % 12 : null;
  const bonus = interval === null || interval === 0 || interval === 7 ? 0 : [3, 4, 10, 11].includes(interval) ? 0.3 : 0.15;
  return 0.35 * covered + (1 - covered) * (1 + bonus);
}

// Perfis de tonalidade de Krumhansl-Kessler, em Dó. A escala menor inclui a
// sensível da menor harmônica.
const KEY_PROFILES = [
  { profile: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], scale: [0, 2, 4, 5, 7, 9, 11] },
  { profile: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], scale: [0, 2, 3, 5, 7, 8, 10, 11] },
];
const KEY_BLOCK = 4, KEY_SUPPORT = 0.25;

function correlation(a, b) {
  const ma = a.reduce((s, x) => s + x) / a.length, mb = b.reduce((s, x) => s + x) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Classes de altura da tonalidade que melhor explica o croma, ou null sem notas.
function keyScale(chroma) {
  if (!chroma.some(x => x > 1e-9)) return null;
  let best = -Infinity, scale = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    for (const key of KEY_PROFILES) {
      const r = correlation(key.profile, rotated);
      if (r > best) { best = r; scale = key.scale.map(d => (d + tonic) % 12); }
    }
  }
  return new Set(scale);
}

// Notas fracas fora da tonalidade local costumam ser harmônicos, vazamento da
// bateria ou erros do transcritor. Na seleção valem até 50% menos; volume e
// afinação não mudam. A tonalidade vem de blocos de 4 s numa janela de 12 s,
// com as notas fortes pesando mais. Uma nota forte da mesma classe de altura
// por perto (acorde emprestado, cromatismo em outra voz) retira a penalidade.
// Notas a partir de 0,45 de intensidade nunca perdem valor.
function harmonicFit(pool) {
  const fit = new Map(), scales = [], chroma = Array(12).fill(0);
  const evidence = n => n.strength ** 2 * Math.min(2, n.end - n.start);
  const last = pool.reduce((t, n) => Math.max(t, n.start), 0);
  let lo = 0, hi = 0;
  for (let w = 0; w <= last; w += KEY_BLOCK) {
    while (hi < pool.length && pool[hi].start < w + 2 * KEY_BLOCK) chroma[pool[hi].midi % 12] += evidence(pool[hi++]);
    while (lo < hi && pool[lo].start < w - KEY_BLOCK) chroma[pool[lo].midi % 12] -= evidence(pool[lo++]);
    scales.push(keyScale(chroma));
  }
  const strong = Array.from({ length: 12 }, () => []);
  for (const n of pool) if (n.strength >= 0.45) strong[n.midi % 12].push(n);
  for (const n of pool) {
    const weakness = Math.max(0, Math.min(1, (0.45 - n.strength) / 0.15));
    const scale = scales[Math.floor(n.start / KEY_BLOCK)];
    if (!weakness || !scale || scale.has(n.midi % 12)) continue;
    if (strong[n.midi % 12].some(o => o.start < n.end + KEY_SUPPORT && o.end > n.start - KEY_SUPPORT)) continue;
    fit.set(n, 1 - 0.5 * weakness);
  }
  return fit;
}

// Cópias da melodia uma oitava abaixo concorrem com as notas restantes a partir
// da terceira linha, valendo uma fração da nota original: um motor de
// acompanhamento dobra a melodia em vez de tocar notas fracas. Com driver sem
// controle de corrente (A4988), o volume da melodia vem do número de motores.
// A cópia fica acima da segunda linha e não coincide com nenhuma nota preparada
// de mesma altura, já escolhida ou não, na duração original: a recuperação de
// sustentações pode devolver a cauda inteira a uma nota cortada.
const DOUBLE_VALUE = 0.7, DOUBLE_FLOOR = 36, DOUBLE_GAIN = 0.8;
function melodyDoubles(leadChain, second, notes) {
  const byPitch = new Map();
  for (const n of notes) {
    if (!byPitch.has(n.midi)) byPitch.set(n.midi, []);
    byPitch.get(n.midi).push(n);
  }
  const copies = leadChain.flatMap((n, k) => {
    const midi = n.midi - 12, end = leadChain[k + 1] ? Math.min(n.end, leadChain[k + 1].start) : n.end;
    if (midi < DOUBLE_FLOOR || end - n.start < 0.03) return [];
    if (overlapping(second, n.start, end).some(o => o.midi >= midi)) return [];
    if ((byPitch.get(midi) ?? []).some(o => o.start < end && o.end > n.start)) return [];
    return [{ start: n.start, end, midi, vel: n.vel * DOUBLE_GAIN, weight: n.weight * DOUBLE_VALUE,
      strength: n.strength, curve: n.curve, span: n.span, nextSamePitch: Infinity, double: true }];
  });
  // O legato não pode atravessar o ataque de outra nota da mesma altura, seja
  // cópia ou nota da transcrição: cada uma pode ir para um motor diferente.
  for (const copy of copies) for (const other of [...(byPitch.get(copy.midi) ?? []), ...copies]) {
    if (other.midi !== copy.midi) continue;
    if (other.start >= copy.end) copy.nextSamePitch = Math.min(copy.nextSamePitch, other.start);
    if (copy.start >= other.end) other.nextSamePitch = Math.min(other.nextSamePitch, copy.start);
  }
  return copies;
}

// Opções (desligadas por padrão):
//   bends: a nota segue a curva fina de afinação do transcritor (vibrato, deslizes); o motor não
//          está preso a semitons. A curva vale para a duração original da nota (span).
//   mix:   cada linha extra toca mais baixo, na proporção da raiz do valor dela em relação à
//          linha 1, para a textura não embolar a melodia (mínimo 35%).
//   balance (ligado): bônus suave para uma segunda voz abaixo da primeira, sem
//          faixa MIDI fixa nem reserva obrigatória de motor para baixo.
//   salience (ligado): usa a intensidade original antes do limite de volume e
//          reduz suavemente o valor de detecções fracas, sem descartá-las.
//   sustain (ligado): transfere sustentações cortadas para um motor disponível.
//   continuity (ligado): reconecta frases entre motores sem alterar as notas
//          selecionadas nem aumentar pausas curtas; preserva a primeira linha na redução.
//   melody: favorece uma frase no registro superior da textura; fundamento na
//          segunda linha e menos dobramentos nas demais. Heurística, não separação de fontes.
//   harmony: notas fracas fora da tonalidade local, sem apoio de nota forte da
//          mesma classe por perto, valem até 50% menos na seleção.
//   voicing (com melody): a partir da terceira linha, classes de altura que já
//          soam valem menos durante toda a sobreposição; terças e sétimas acima
//          da voz mais grave valem mais.
//   double (com melody): a partir da terceira linha, a melodia uma oitava abaixo
//          concorre com as notas restantes. Essas cópias levam `double: true`.
export function dynamicLines(notes, motors, { bends = false, mix = false, balance = true, salience = true, sustain = true, melody = false, continuity = true, harmony = false, voicing = false, double = false } = {}) {
  let pool = prepareLineNotes(notes, salience)
    .sort((a, b) => a.start - b.start || b.vel - a.vel);
  const prepared = pool;
  const leadPriority = melody ? melodyPriorities(pool) : null;
  const fit = harmony ? harmonicFit(pool) : null;
  const tracks = [], origins = new Map();
  let first = 0, leadChain = [];
  for (let m = 0; m < motors; m++) {
    if (double && melody && m === 2) {
      pool = [...pool, ...melodyDoubles(leadChain, tracks[1], prepared)].sort((a, b) => a.start - b.start || b.vel - a.vel);
    }
    const role = melody && m === 0 ? n => leadPriority.get(n) : balance && m === 1 ? (n) => {
      const lead = noteAt(tracks[0], (n.start + n.end) / 2);
      // Uma quinta abaixo começa a ganhar valor; a 19 semitons o bônus chega
      // a 30% nas linhas dinâmicas, 100% na redução. Silêncios e uma primeira
      // linha já grave não forçam outro baixo.
      return lead ? 1 + (melody ? 1 : 0.3) * Math.max(0, Math.min(1, (lead.midi - n.midi - 7) / 12)) : 1;
    } : melody && m >= 2 ? n => (n.double ? 1 : voicing ? chordRole(n, tracks) : octaveRedundancy(n, tracks)) : undefined;
    const priority = fit ? n => (role ? role(n) : 1) * (fit.get(n) ?? 1) : role;
    const params = melody && m === 0 ? { ...LINE, intC: 0.1, intK: 0.25, jumpC: 1.6, jump0: 5, noteC: 0.005 } : LINE;
    const { chain, total } = bestChain(pool, priority, params);
    // Bônus de seleção não são volume: compara as linhas na mesma escala.
    const value = melody ? chain.reduce((sum, n, k) => sum + n.weight *
      ((chain[k + 1] ? Math.min(n.end, chain[k + 1].start) : n.end) - n.start), 0) : total;
    if (m === 0) { first = value; leadChain = chain; }
    const gain = mix && first > 0 ? Math.min(1, Math.max(0.35, Math.sqrt(value / first))) : 1;
    const used = new Set(chain);
    pool = pool.filter((n) => !used.has(n));
    const line = chain.map((n, k) => {
      const note = { midi: n.midi, start: n.start, end: chain[k + 1] ? Math.min(n.end, chain[k + 1].start) : n.end, vel: n.vel * gain };
      if (bends && n.curve?.length) Object.assign(note, { bends: n.curve, span: n.span });
      if (n.double) note.double = true;
      origins.set(note, n.end);
      return note;
    });
    for (let k = 0; k < line.length - 1; k++) {
      const gap = line[k + 1].start - line[k].end;
      const a = line[k], b = line[k + 1];
      // Não transforma staccato rápido em sustentação, nem preenche pausas
      // entre registros distantes. Nunca estende por cima de outro ataque uníssono.
      const limit = Math.min(LEGATO, (a.end - a.start) * 0.5, (b.end - b.start) * 0.5);
      if (gap > 0 && gap <= limit && Math.abs(a.midi - b.midi) <= 7) {
        a.end = Math.min(b.start, chain[k].nextSamePitch);
      }
    }
    tracks.push(articulate(line));
  }
  if (sustain) restoreSustains(tracks, origins, melody);
  if (continuity) connectVoices(tracks, melody ? 1 : 0);
  return tracks;
}

// A seleção gulosa pode deixar a continuação de uma frase em outro motor.
// Troca somente sufixos inteiros em fronteiras livres nos dois motores. Assim
// preserva todas as notas selecionadas, suas durações, volume e vibrato, sem
// interromper uma nota, inventar ataques ou esticar silêncios. A melodia é fixa.
function connectVoices(tracks, first) {
  const shortBreak = (a, b) => a && b && b.start - a.end > 0.03 && b.start - a.end < 0.3 ? 1 : 0;
  const cost = (a, b) => {
    if (!a || !b) return 0.6; // começo/fim de uma linha
    const gap = b.start - a.end;
    if (gap >= 0.8) return 1.2; // outra frase: sem identidade imposta entre elas
    return gap / 0.8 + Math.min(3, Math.abs(a.midi - b.midi) / 12);
  };
  const times = [...new Set(tracks.slice(first).flatMap(t => t.map(n => n.start)))].sort((a, b) => a - b);
  const positions = tracks.map(() => 0);
  for (const time of times) {
    for (let a = first; a < tracks.length; a++) {
      while (positions[a] < tracks[a].length && tracks[a][positions[a]].start < time) positions[a]++;
    }
    for (let a = first; a < tracks.length; a++) for (let b = a + 1; b < tracks.length; b++) {
      const i = positions[a], j = positions[b];
      const ap = tracks[a][i - 1], an = tracks[a][i], bp = tracks[b][j - 1], bn = tracks[b][j];
      if (ap?.end > time || bp?.end > time) continue;
      // Sem passado nos dois lados, a troca apenas renomearia os motores.
      if (!ap && !bp) continue;
      // Proximidade de altura sozinha pode transformar uma linha contínua em
      // várias pausas curtas. Nunca aceita esse aumento de fragmentação.
      if (shortBreak(ap, bn) + shortBreak(bp, an) > shortBreak(ap, an) + shortBreak(bp, bn)) continue;
      const before = cost(ap, an) + cost(bp, bn), after = cost(ap, bn) + cost(bp, an);
      if (after + 1e-9 >= before) continue;
      const tailA = tracks[a].splice(i), tailB = tracks[b].splice(j);
      tracks[a].push(...tailB);
      tracks[b].push(...tailA);
    }
  }
  // Atualiza só a articulação, sem alterar durações após a troca de vozes.
  for (let m = first; m < tracks.length; m++) for (let i = 0; i < tracks[m].length; i++) {
    const n = tracks[m][i], prev = tracks[m][i - 1];
    delete n.reattack;
    if (prev && prev.midi === n.midi && n.start - prev.end < REATTACK) n.reattack = true;
  }
}

// A seleção gulosa pode cortar uma nota para iniciar outra mesmo havendo um
// motor livre. Move a nota inteira, desde seu ataque real, para caber a cauda.
// Nunca interrompe outra voz nem prolonga além do fim estimado da transcrição.
function restoreSustains(tracks, origins, preserveLead = false) {
  const candidates = tracks.slice(preserveLead ? 1 : 0).flat().filter(n => origins.get(n) - n.end > LINE.tail)
    .sort((a, b) => (origins.get(b) - b.end) * b.vel - (origins.get(a) - a.end) * a.vel);
  for (const note of candidates) {
    const source = tracks.find(track => track.includes(note)), end = origins.get(note);
    let best = null, cost = Infinity;
    for (const track of tracks) {
      if (preserveLead && track === tracks[0]) continue;
      if (track === source || track.some(n => n.start < end && n.end > note.start)) continue;
      const prev = track.findLast(n => n.end <= note.start);
      const next = track.find(n => n.start >= end);
      const transition = (prev && note.start - prev.end < LINE.phrase ? Math.abs(prev.midi - note.midi) : 0)
        + (next && next.start - end < LINE.phrase ? Math.abs(next.midi - note.midi) : 0);
      if (transition < cost) { best = track; cost = transition; }
    }
    if (!best) continue;
    source.splice(source.indexOf(note), 1);
    note.end = end;
    best.push(note);
    best.sort((a, b) => a.start - b.start);
  }
  // Re-ataques dependem dos vizinhos no motor de destino.
  for (const track of tracks) {
    for (const note of track) delete note.reattack;
    articulate(track);
  }
}

// Um motor já reproduz um uníssono: duplicatas não devem consumir vozes extras.
// Um ataque posterior da mesma altura encerra a cauda anterior, mas continua
// sendo um ataque real; não juntamos notas repetidas nem inventamos reinícios.
function prepareLineNotes(notes, salience) {
  const pitches = new Map();
  for (const [start, end, midi, amp, curve] of notes) {
    if (![start, end, midi, amp].every(Number.isFinite) || start < 0 || end - start < 0.03
        || midi < 0 || midi > 127) continue;
    const strength = Math.max(0, Math.min(1, amp));
    const vel = Math.min(1, 0.4 + 0.8 * strength);
    // O volume satura a partir de amp=0,75; isso não pode apagar diferenças
    // na seleção. A intensidade da rede é evidência, não probabilidade calibrada.
    const weight = salience ? (0.4 + 1.6 * strength) * Math.min(1, 0.25 + 1.25 * strength)
      : Math.max(0.05, LINE.base + LINE.velW * (vel - 0.7));
    const note = { start, end, midi, vel, weight, strength, curve, span: end - start };
    if (!pitches.has(midi)) pitches.set(midi, []);
    pitches.get(midi).push(note);
  }
  const out = [];
  for (const group of pitches.values()) {
    group.sort((a, b) => a.start - b.start || b.weight - a.weight || b.end - a.end);
    const unique = group.filter((n, i) => i === 0 || n.start !== group[i - 1].start);
    unique.forEach((n, i) => {
      n.nextSamePitch = unique[i + 1]?.start ?? Infinity;
      n.end = Math.min(n.end, n.nextSamePitch);
      if (n.end - n.start >= 0.03) out.push(n);
    });
  }
  return out;
}

// Altura (MIDI fracionário) de uma nota com curva de afinação no instante t da partitura.
export function bentMidi(note, t) {
  const b = note.bends;
  const k = Math.floor(((t - note.start) / note.span) * b.length);
  return note.midi + b[Math.min(b.length - 1, Math.max(0, k))];
}

// Percussão num motor: golpes curtos; em golpes quase simultâneos fica o de maior prioridade.
// Altura, duração e ruído de cada peça foram escolhidos de ouvido para o modelo mecânico.
export const DRUM_VOICE = {
  kick: { midi: 33, dur: 0.07, noise: 0.1, gain: 1 },     // Lá1 (55 Hz): baque grave
  snare: { midi: 50, dur: 0.05, noise: 0.7, gain: 0.9 },  // Ré3 + ruído
  hat: { midi: 93, dur: 0.02, noise: 0.8, gain: 0.45 },   // Lá6 curtíssimo + ruído
};
const DRUM_PRIORITY = { kick: 3, snare: 2, hat: 1 };

export function percussionTrack(drums) {
  const out = [];
  for (const [t, kind, strength] of drums) {
    const prev = out.at(-1);
    if (prev && t - prev.start < 0.04) {
      if (DRUM_PRIORITY[kind] <= DRUM_PRIORITY[prev.kind]) continue;
      out.pop();
    }
    const v = DRUM_VOICE[kind];
    out.push({ midi: v.midi, start: t, end: t + v.dur, vel: v.gain * (0.5 + 0.5 * strength), noise: v.noise, kind });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end, out[i + 1].start - 0.005);
  return out;
}

// Arranjo completo para N motores. Métodos: 'melodia' (redução com prioridade melódica),
// 'linhas' (linhas dinâmicas) e 'papeis' (melodia/harmonia/baixo). Com percussão, o
// último motor vira percussão.
export function arrangeMotors(job, motors, { method = 'linhas', density = 'media', percussion = true, threshold, bends = false, mix = false, balance = true, salience = true, sustain = true, continuity = true, harmony = false, voicing = false, double = false } = {}) {
  const drums = percussion && motors >= 2 && job.drums?.length ? job.drums : null;
  const tonal = drums ? motors - 1 : motors;
  let tracks, roles;
  if (method === 'linhas' || method === 'melodia') {
    const candidates = job.density?.[density] ?? job.notes;
    const notes = threshold === undefined ? candidates : candidates.filter(n => n[3] >= threshold);
    tracks = dynamicLines(notes, tonal, { bends, mix, balance, salience, sustain, continuity, harmony, voicing, double, melody: method === 'melodia' });
    roles = tracks.map(() => '');
  } else {
    ({ tracks, roles } = arrange(job, tonal, { threshold }));
  }
  if (drums) { tracks = [...tracks, percussionTrack(drums)]; roles = [...roles, 'percussão']; }
  return { title: job.title, tracks, roles, duration: job.duration };
}
```

### D.1 Prioridade melódica anterior, usada na comparação congelada

Para reproduzir a diferença de arranjo, substitua a função `melodyPriorities` da fonte anterior por esta. A função `harmonicCoverage` atual pode permanecer definida sem uso. A cópia preservada já continha o filtro opcional `threshold` em `arrangeMotors`, portanto ele não muda entre as duas condições.


```javascript
function melodyPriorities(pool) {
  const priorities = new Map(), active = new Set();
  let next = 0;
  for (const n of pool) {
    const t = n.start;
    while (next < pool.length && pool[next].start <= t + 0.5) active.add(pool[next++]);
    for (const other of active) if (other.end < t - 0.5) active.delete(other);
    let strongest = 0;
    for (const other of active) strongest = Math.max(strongest, other.strength);
    const floor = Math.max(0.18, strongest * 0.5);
    let below = 0, total = 0, pitchSum = 0, harmonicShadow = 1;
    let previous = 0, following = 0, competing = false;
    let prevNote = null, nextNote = null;
    for (const other of active) {
      if (other === n || other.strength < Math.max(0.12, n.strength * 0.6)) continue;
      const proximity = Math.max(0, 1 - Math.abs(n.midi - other.midi) / 7);
      if (other.start < n.start && Math.abs(other.end - n.start) <= 0.18 && proximity > previous) {
        previous = proximity;
        prevNote = other;
      }
      if (other.start > n.start && Math.abs(other.start - n.end) <= 0.18 && proximity > following) {
        following = proximity;
        nextNote = other;
      }
    }
    for (const other of active) {
      const interval = n.midi - other.midi;
      const octave = interval >= 12 && interval % 12 === 0;
      // 3º, 5º e 6º harmônicos arredondados ao semitom. Exige coincidência
      // temporal mais estrita que para oitavas para não punir terças/quintas reais.
      const overtone = [19, 28, 31].includes(interval) && n.strength < other.strength * 0.75
        && Math.abs(other.start - n.start) <= 0.06 && Math.abs(other.end - n.end) <= 0.08;
      if ((octave || overtone) && other.strength > n.strength * 1.1
          && Math.abs(other.start - n.start) <= 0.25 && Math.abs(other.end - n.end) <= 0.25) {
        // Coincidir com um harmônico numa nota do acorde não torna a frase
        // inteira um harmônico. Se a vizinha aguda se move independentemente
        // da voz grave, conserva a nota na linha melódica.
        const independent = [prevNote, nextNote].some(neighbor => neighbor && ![...active].some(lower =>
          lower.midi === neighbor.midi - interval && lower.strength > neighbor.strength * 1.1
          && Math.abs(lower.start - neighbor.start) <= 0.06 && Math.abs(lower.end - neighbor.end) <= 0.08));
        // Uma cópia mais fraca, com ataque e fim próximos, pode ser um harmônico
        // do transcritor ou um dobramento. Prefere a oitava com mais evidência.
        const overlap = Math.max(0, Math.min(n.end, other.end) - Math.max(n.start, other.start));
        if (!independent) harmonicShadow = Math.min(harmonicShadow, 1 - (overtone ? 0.97 : 0.85) * overlap / (n.end - n.start));
      }
      if (other !== n && other.strength >= floor && other.start <= n.start && other.end >= n.end && interval > 7) competing = true;
      if (other.strength < floor) continue;
      const evidence = other.strength * Math.min(1, other.end - other.start);
      total += evidence;
      pitchSum += evidence * other.midi;
      if (other.midi < n.midi) below += evidence;
      else if (other.midi === n.midi) below += evidence * 0.5;
    }
    const rank = total ? below / total : 0.5;
    const center = total ? pitchSum / total : n.midi;
    // Só o percentil comprime as distâncias num acorde muito cheio: a melodia
    // uma oitava acima precisa se distinguir da nota superior da sustentação.
    const register = 2 ** Math.max(-2, Math.min(2, (n.midi - center) / 12));
    const reliable = Math.min(1, n.strength / floor);
    // O acompanhamento forte não pode fazer uma frase aguda suave parecer
    // vários picos isolados. Vizinhas de intensidade semelhante sustentam a
    // evidência da frase, mesmo abaixo do piso usado para estimar o registro.
    const support = Math.max(previous, following);
    let phraseStrength = n.strength;
    for (const other of active) if (Math.abs(other.midi - n.midi) <= 7) {
      phraseStrength = Math.max(phraseStrength, other.strength);
    }
    const phraseConfidence = Math.min(1, n.strength / Math.max(0.18, phraseStrength * 0.5));
    const confidence = reliable ** 4 * (1 - support) + phraseConfidence * support;
    // Um pico agudo curto isolado não deve cortar uma frase sustentada.
    // Uma sequência rápida com vizinhas próximas conserva sua prioridade.
    const continuity = competing && n.end - n.start < 0.3 ? 0.15 + 0.85 * support : 1;
    priorities.set(n, (0.15 + 3.85 * rank ** 3 * register * confidence) * harmonicShadow * continuity);
  }
  return priorities;
}
```

## Apêndice E. Código de avaliação e gabarito sintético

### E.1 Avaliador de alturas contra referência

`evaluate-arrangement.mjs`: aceita arquivos JSON. Para usar isoladamente, adapte apenas o caminho do import de `score.mjs`. A cobertura por track de referência pode ser satisfeita por qualquer voz estimada; não mede diretamente preservação do tema na voz 1.


```javascript
// Avaliação temporal contra uma partitura de referência, sem bibliotecas externas.
// Não mede F1 de ataques: cobertura, precisão e recall usam uma grade de 10 ms.
import { readFileSync } from 'node:fs';
import { dynamicLines, noteAt } from '../score.mjs';

const [notesPath, referencePath, density = 'media'] = process.argv.slice(2);
if (!notesPath || !referencePath) {
  console.error('Uso: node scripts/evaluate-arrangement.mjs notas.json gabarito.json [normal|media|alta]');
  process.exit(1);
}
const job = JSON.parse(readFileSync(notesPath, 'utf8'));
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const notes = density === 'normal' ? job.notes : job.density?.[density] ?? job.notes;
if (!['normal', 'media', 'alta'].includes(density) || !Array.isArray(notes)
    || !Array.isArray(reference.tracks) || !(reference.duration > 0)
    || !Number.isFinite(reference.duration)) {
  throw new Error('Densidade, notas ou partitura de referência inválidas.');
}
const frames = Array.from({ length: Math.ceil(reference.duration / 0.01) }, (_, i) => {
  const t = i * 0.01;
  const pitches = reference.tracks.map(track => noteAt(track, t)?.midi ?? null);
  return { t, pitches, set: new Set(pitches.filter(p => p !== null)) };
});
function measure(tracks) {
  const hits = reference.tracks.map(() => 0), totals = reference.tracks.map(() => 0);
  let correct = 0, predicted = 0, expected = 0;
  for (const { t, pitches, set } of frames) {
    const estimate = new Set(tracks.map(track => noteAt(track, t)?.midi ?? null).filter(p => p !== null));
    for (let i = 0; i < pitches.length; i++) if (pitches[i] !== null) {
      totals[i]++;
      if (estimate.has(pitches[i])) hits[i]++;
    }
    expected += set.size;
    predicted += estimate.size;
    for (const p of estimate) if (set.has(p)) correct++;
  }
  const percent = (n, d) => d ? Number((100 * n / d).toFixed(2)) : null;
  return {
    coverageByReferenceTrack: hits.map((n, i) => percent(n, totals[i])),
    pitchPrecision: percent(correct, predicted),
    pitchRecall: percent(correct, expected),
  };
}
const comparisons = [1, 2, 3, 4, 6, 8, 12].map(motors => ({
  motors,
  previous: measure(dynamicLines(notes, motors, { salience: false, sustain: false })),
  unbalanced: measure(dynamicLines(notes, motors, { balance: false })),
  withoutSustain: measure(dynamicLines(notes, motors, { sustain: false })),
  balanced: measure(dynamicLines(notes, motors)),
  melody: measure(dynamicLines(notes, motors, { melody: true })),
}));
console.log(JSON.stringify({ density, frameSeconds: 0.01, percentages: true, comparisons }, null, 2));
```

### E.2 Fixture de doze vozes com tema suave


```javascript
// Caso controlado, não transcrição de Test Drive: doze vozes simultâneas,
// tema móvel mais suave que as onze sustentações. Notas originais de teste.
export function denseOrchestra(transpose = 0) {
  const theme = [76, 78, 79, 76, 74, 76, 79, 78];
  const melody = theme.map((midi, i) => ({ start: i * 0.5, end: (i + 1) * 0.5, midi: midi + transpose }));
  const accompaniment = [36, 43, 48, 50, 52, 55, 57, 59, 60, 62, 64]
    .map(midi => ({ start: 0, end: 4, midi: midi + transpose }));
  const notes = [...melody.map(n => [n.start, n.end, n.midi, 0.4]),
    ...accompaniment.map(n => [n.start, n.end, n.midi, 0.6])];
  return { title: 'Textura densa de teste', duration: 4, notes,
    tracks: [melody, ...accompaniment.map(n => [n])] };
}
```

### E.3 Definição exata das estatísticas auxiliares desta comparação

A quantidade de motores e demais opções estão no cabeçalho da seção 7. Este trecho não calcula acurácia musical.


```javascript
function describeFirstVoice(track, duration) {
  let gaps = 0, gapSeconds = 0;
  for (let i = 1; i < track.length; i++) {
    const gap = track[i].start - track[i - 1].end;
    if (gap > 0.15) { gaps++; gapSeconds += gap; }
  }
  return {
    notes: track.length,
    occupancyPct: 100 * track.reduce((s, n) => s + n.end - n.start, 0) / duration,
    internalGapsOver150ms: gaps,
    internalGapSeconds: gapSeconds,
    introOccupancyPct: 100 * track.filter(n => n.start < 8)
      .reduce((s, n) => s + Math.min(n.end, 8) - n.start, 0) / 8,
  };
}
```

## Apêndice F. Ambiente, integridade e módulos complementares

### F.1 Dependências declaradas

Basic Pitch é instalado separadamente como `basic-pitch==0.4.0 --no-deps`. Python da sessão: 3.13; Node observado: 24.19.0. São detalhes do ambiente local, não garantias de portabilidade nem exigências científicas do problema.


```text
numpy==2.5.3
librosa==0.11.0
yt-dlp[default]
yt-dlp-ejs==0.8.0
imageio-ffmpeg==0.6.0
# Dependências do basic-pitch, que é instalado com --no-deps (ver run.sh):
# ele pediria TensorFlow, que não existe para Python 3.13; usamos o backend ONNX.
onnxruntime==1.31.1
pretty-midi==0.2.11.post0
mir-eval==0.8.2
resampy==0.4.3
scikit-learn==1.9.1
typing-extensions==4.16.0
```

### F.2 Hashes SHA-256 do snapshot

Permitem identificar os arquivos usados nas comparações, caso eles sejam enviados depois. Os hashes de caches não substituem os próprios dados. Caminhos são relativos à raiz original do projeto.


| Arquivo | SHA-256 |
| --- | --- |
| score.mjs | 375fa91ad6ae11c9ddbea6aa312f17fce7a780fd4927b29a6ff7377a00f84436 |
| transcribe.py | f62fcd04f3f8396e01a1fd71fb7f44ba440051ea3a6890913f133e02e83931a9 |
| engine.mjs | 579af19ca4e3204f24cb72d0643aeb95d74a673e82366c8c89c7f30c5a958ed8 |
| physics.mjs | 48d80ee2d0cce4cbb72877b4bbc555740e7fcd3bcdf636dcdabaf63c9e35d8f2 |
| bells.mjs | c09f1073dc74710c20a7810cbd99fe18a7cf391fd43cdebfb05fc9d1c08eb2aa |
| percussion.py | 58c393d4da689fc69290ebc6db0b875201e932ec3a09f647390e993c92e8ec0f |
| server.py | 27059be794493b3542c13ba75ad1a3f257c6d3a09e9c5ec7e729dfe8289a7a11 |
| requirements.txt | 28e973aed488956697b97340c837641a62ba87016530716bb2b54f2a595bef4d |
| downloads/0FCvzsVlXpQ/notes.json | c3800ac5b1bc38c63ccb9b6cf350cfb6ae0056c25761632346519b7af4670b26 |
| downloads/PJ1yqbr8Y50/notes.json | 16315781027966baf39f14428696907f4fa48e0839d37a8de7710624202fc91d |


### F.3 Modelo mecânico completo

Incluído para separar erro de seleção de nota de limitação do instrumento simulado. Os parâmetros não vêm de calibração de hardware real.


```javascript
// Modelo mecânico simplificado de um motor de passo. Função pura, sem Web Audio,
// para poder ser testada no Node. Unidades: "w" é a taxa de passos completos (Hz).
//
// Cadeia: nota → frequência de passos desejada → pulsos do driver (× micropassos)
//         → limites do driver e do motor → dinâmica (1ª ordem + aceleração máxima)
//         → ressonância → som.
// A dinâmica e a perda de passos são aproximações fenomenológicas, não um modelo de torque.

export const DEFAULT_PHYSICS = {
  steps: 200,        // passos completos por volta (1,8°)
  micro: 1,          // fator de micropassos
  maxRpm: 900,       // velocidade máxima que o motor alcança
  maxAccel: 30000,   // aceleração máxima com inércia 1× (RPM/s)
  inertia: 1,        // multiplicador da inércia do rotor + carga
  tau: 0.008,        // constante de tempo da resposta (s), com inércia 1×
  driverMax: 20000,  // maior taxa de pulsos que o driver gera (Hz)
  resFreq: 700,      // frequência natural do conjunto rotor/carcaça (Hz)
  resonance: 0.5,    // intensidade da ressonância (0 a 1)
  damping: 0.15,     // fator de amortecimento ζ
};

export const SIM_DT = 1 / 250;

export const rpmFromPulses = (pulseHz, P) => (60 * pulseHz) / (P.steps * P.micro);

// Fator de amplificação de um oscilador harmônico amortecido excitado em r = f/fn.
export function magnification(f, P) {
  const r = f / P.resFreq, z = P.damping;
  return 1 / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
}

// Avança um passo de simulação. `cmd` é { freq, vel } (frequência da nota) ou null.
// `random` é injetável para testes determinísticos.
export function stepMotor(state, cmd, P, dt = SIM_DT, random = Math.random) {
  const desired = cmd ? cmd.freq : 0;                 // passos completos/s pedidos pela nota
  const pulseCmd = desired * P.micro;                  // pulsos/s que o driver teria de gerar
  const driverSat = pulseCmd > P.driverMax;
  const maxSteps = (P.maxRpm * P.steps) / 60;
  const reachable = Math.min(pulseCmd, P.driverMax) / P.micro;
  const speedSat = reachable > maxSteps;
  const target = Math.min(reachable, maxSteps);

  // 1ª ordem com constante de tempo proporcional à inércia, limitada pela aceleração
  // (torque / inércia). Simplificação: não modela curva torque × velocidade.
  const tau = Math.max(1e-4, P.tau * P.inertia);
  const aMax = (P.maxAccel * P.steps) / 60 / P.inertia;     // passos/s²
  let dw = (target - state.w) * (1 - Math.exp(-dt / tau));
  dw = Math.max(-aMax * dt, Math.min(aMax * dt, dw));
  let w = state.w + dw;

  // Ressonância de meia faixa: perto da frequência natural a vibração cresce e,
  // se passar de um limiar, o rotor perde passos (velocidade efetiva cai aos trancos).
  const mag = magnification(w, P);
  const risk = P.resonance * mag;
  const losing = Boolean(cmd) && w > 20 && risk > 2.5;
  if (losing) w *= 1 - Math.min(0.35, (risk - 2.5) * 0.05) * random();

  // Amplitude do som: depende da intensidade da nota, da velocidade (motor quase parado
  // quase não vibra) e da ressonância.
  const presence = Math.min(1, w / 60);
  const boost = 1 + P.resonance * (Math.min(mag, 6) - 1) * 0.35;
  const amp = cmd ? cmd.vel * presence * boost : 0;

  return {
    w, desired, pulseCmd, target, driverSat, speedSat, losing, mag, amp,
    rpm: (w * 60) / P.steps,
    lagging: Boolean(cmd) && Math.abs(w - desired) > desired * 0.03,
  };
}
```

### F.4 Detector de percussão completo

A separação HPSS abaixo é usada para detectar golpes, não como uma frente de separação instrumental para a transcrição tonal.


```python
"""Golpes para o motor de percussão.

O espectro (CQT) é separado em parte tonal e percussiva (HPSS); na percussiva, os picos do fluxo
de energia por banda viram golpes de bumbo, caixa e chimbal. No gabarito sintético o motor de
percussão acerta 84% dos golpes reais (F=0,67), mas confunde as peças com frequência.
"""
import numpy as np

SR = 22050
HOP = 512
DT = HOP / SR
BPO = 36
LOW_MIDI = 24                      # Dó1: primeiro bin da CQT
NBINS = BPO * 8                    # até ~Dó9
BANDS = {"kick": (40, 130), "snare": (180, 5000), "hat": (5500, 12000)}


def detect_drums(wav_path, delta=0.25):
    import librosa

    y, _ = librosa.load(str(wav_path), sr=SR, mono=True)
    fmin = librosa.midi_to_hz(LOW_MIDI)
    C = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=fmin, n_bins=NBINS, bins_per_octave=BPO))
    _, P = librosa.decompose.hpss(C, kernel_size=(17, 17), margin=1.0)
    freqs = librosa.cqt_frequencies(NBINS, fmin=fmin, bins_per_octave=BPO)
    total = np.percentile(P.sum(axis=0), 99) + 1e-9
    hits = []
    for kind, (lo, hi) in BANDS.items():
        energy = np.log1p(50 * P[(freqs >= lo) & (freqs < hi)].sum(axis=0) / total)
        flux = np.maximum(0, np.diff(energy, prepend=energy[0]))
        flux /= np.percentile(flux, 99.5) + 1e-9
        for p in librosa.util.peak_pick(flux, pre_max=2, post_max=2, pre_avg=8, post_avg=2, delta=delta, wait=4):
            hits.append([round(float(p * DT), 3), kind, round(float(min(1, flux[p])), 2)])
    return sorted(hits)
```

### F.5 Timbre de sinos completo

As caudas continuam depois do evento de nota; há cancelamento explícito em mudanças de transporte. O sintetizador foi validado no navegador com renderização offline, sobreposição de golpes e cancelamento de notas futuras, mas isso não é avaliação da fidelidade melódica.


```javascript
// Sino sintético: modos de vibração com decaimentos diferentes. As caudas de
// golpes anteriores continuam soando, mesmo quando a voz passa à próxima nota.
import { mtof } from './score.mjs';

const MODES = [
  // frequência relativa, intensidade, tempo de decaimento (s)
  [0.5, 0.14, 0.9], [1, 1, 0.85], [1.19, 0.22, 0.6],
  [1.5, 0.16, 0.5], [2, 0.3, 0.4], [2.76, 0.13, 0.25], [4.07, 0.08, 0.15],
];
const TAIL = 4.5;

export class Bells {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = output;
    this.strikes = new Set();
    this.lastNote = null;
    this.lastPosition = null;
  }

  update(cmd, t, position) {
    const id = cmd ? cmd.src ?? cmd : null;
    const wrapped = position !== null && this.lastPosition !== null && position < this.lastPosition;
    if (cmd && (id !== this.lastNote || wrapped)) this.strike(cmd.midi, cmd.vel, t);
    this.lastNote = id;
    this.lastPosition = position;
  }

  strike(midi, velocity, t) {
    const { ctx } = this;
    const frequency = mtof(midi);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.22 * velocity, t);
    envelope.gain.setValueAtTime(0.22 * velocity, t + TAIL - 0.03);
    envelope.gain.linearRampToValueAtTime(0, t + TAIL);
    envelope.connect(this.output);
    const strike = { t, envelope, sources: [], gains: [] };
    this.strikes.add(strike);
    for (const [ratio, amplitude, decay] of MODES) {
      if (frequency * ratio >= ctx.sampleRate / 2) continue;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.frequency.value = frequency * ratio;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(amplitude, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(amplitude * Math.exp(-TAIL / decay), t + TAIL);
      oscillator.connect(gain).connect(envelope);
      strike.sources.push(oscillator);
      strike.gains.push(gain);
      oscillator.start(t);
      oscillator.stop(t + TAIL);
    }
    let remaining = strike.sources.length;
    const cleanup = () => {
      envelope.disconnect();
      for (const gain of strike.gains) gain.disconnect();
      this.strikes.delete(strike);
    };
    for (const source of strike.sources) source.onended = () => {
      source.disconnect();
      if (--remaining === 0) cleanup();
    };
    if (!remaining) cleanup();
  }

  // Também cancela golpes que estavam no lookahead: parar/pular não deixa notas
  // antigas começarem a tocar depois da mudança de transporte.
  reset(t) {
    for (const strike of this.strikes) {
      const param = strike.envelope.gain;
      param.cancelScheduledValues(t);
      if (strike.t >= t) param.setValueAtTime(0, t);
      else param.setTargetAtTime(0, t, 0.005);
      for (const source of strike.sources) source.stop(t + 0.03);
    }
    this.lastNote = null;
    this.lastPosition = null;
  }
}
```

## Apêndice G. Instrução final ao agente que receber este arquivo

Use este documento como contexto do projeto, não como prova de que uma solução já existe. Pesquise a literatura e as implementações atuais, teste as hipóteses contra os exemplos e recomende o próximo experimento com maior poder de distinguir causas e abordagens.

Cite fontes primárias e mantenha separados: resultado publicado, medição local, observação do usuário, inferência e hipótese ainda não testada. Não invente gabaritos, acesso ao repositório, escuta humana ou resultados de execução. Se não puder executar, entregue uma análise e um protocolo reproduzível que outra pessoa possa executar.

O problema continua aberto principalmente em MEGALOVANIA: há evidência de seleção incorreta de harmônicos, mas também problemas de ataques e de limites de notas. O objetivo final é recuperar a estrutura musical percebida com orçamento pequeno de vozes, preservando pausas e articulações verdadeiras e generalizando para outras músicas.
