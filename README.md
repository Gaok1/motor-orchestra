# Sinfonia de Motores

Uma orquestra de motores de passo virtuais no navegador. Cada motor toca uma nota por vez, com o som produzido pela vibração dos passos, como nos projetos de floppies e motores musicais ([Moppy2](https://github.com/samphonic/Moppy2)). Você pode tocar notas e acordes à mão, usar três demonstrações, escrever uma partitura ou colar um link do YouTube: o app transcreve a música e faz um arranjo dela para os motores.

O objetivo é provar o conceito antes de um protótipo físico. Ouvir a diferença entre a síntese ideal e a mecânica, e ver onde os limites do motor atrapalham a música. O plano do protótipo (motores, drivers, controlador, custos) está em [HARDWARE.md](HARDWARE.md).

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
  - O cache só é publicado depois da gravação completa. Se estiver incompleto, inválido, desatualizado ou sem o WAV, clicar em “Transcrever” refaz a análise; um WAV já disponível é reaproveitado.
  - *Distribuição* escolhe como as notas vão para os motores: *Redução orquestral (melodia primeiro)* (padrão da interface), *Linhas dinâmicas* ou *Papéis*. Ver a seção seguinte.
  - *Densidade de notas* (redução orquestral e linhas dinâmicas): quantas notas fracas a transcrição aceita. A interface começa em *Alta*, para dar acesso ao tema mesmo quando ele está fraco na mistura. A quantidade de motores continua independente da densidade; mais notas candidatas também trazem mais erros de transcrição.
  - *Intensidade mínima das notas* (todos os modos): filtro numérico aplicado às notas da densidade escolhida antes do arranjo, ajustável de **0** a **0,65**. Começa em **0,15**; aumentar para **0,30** ou mais descarta notas mais suaves. Zero mantém todas as notas já detectadas, sem recuperar as que faltam na transcrição. O ajuste refaz o arranjo sem transcrever novamente. Na API, `threshold` continua opcional: omiti-lo mantém todas as candidatas nos modos de linhas e redução, e o corte de 0,30 no modo de papéis.
  - *Motor de percussão* transforma o último motor em bumbo, caixa e chimbal.
  - *Vibrato e deslizes* (opcional, na redução orquestral e nas linhas dinâmicas): cada nota segue a curva fina de afinação do transcritor, sem ficar presa a semitons.
  - *Volume por importância* (opcional, nos mesmos dois modos): atenua linhas extras conforme seu valor. Na redução, os bônus de seleção não entram no cálculo de volume.
  - *Manter frases no mesmo motor* (ligado por padrão): reorganiza as continuações das linhas sem mudar as notas, durações, volumes ou vibratos selecionados. Só aceita trocas que não aumentem as pausas de 30–300 ms; na redução orquestral, a melodia do primeiro motor fica fixa.
  - *Filtrar notas fora da harmonia* (ligado por padrão), *Acompanhamento completa o acorde* e *Motores livres dobram a melodia* (todos ligados por padrão): ver [Harmonia e dobramentos](#harmonia-e-dobramentos). A primeira vale nos dois modos; as outras duas, só na redução orquestral, a partir do terceiro motor tonal (com percussão ligada, a partir de 4 motores).
  - *Áudio original* mistura a faixa real para comparar. Ela não passa pelos gráficos.
  - Adicionar ou remover motores refaz o arranjo na hora.
- **Som:** “A · Ideal” toca senoides exatas na frequência da nota; “B · Motores” toca a simulação do motor. A troca funciona no meio da música.
- **C · Sinos:** toca o mesmo arranjo com sinos sintéticos, com ataque curto, parciais metálicos e caudas de ressonância que se sobrepõem entre notas. Cada nota dispara um golpe, inclusive nas repetições e voltas do trecho; segurar “▶ Nota” dispara uma vez e deixa o sino decair. A troca de som funciona durante a reprodução. Os sinos usam a afinação da nota, sem os limites mecânicos; os cartões e o gráfico de dinâmica continuam mostrando a simulação dos motores.
- **Posição:** o slider no painel de reprodução avança ou volta a música; ao soltar, ela continua dali (parada, começa dali no próximo “Tocar”).
- **Trecho:** a barra abaixo do rolo mostra a música inteira. Arraste nela para tocar só um trecho (com *Repetir*, ele fica em loop; sem, a música para no fim dele), arraste as bordas para ajustar e clique para pular para um ponto. Clicar fora do trecho desfaz a seleção, e “Tocar tudo” também. Com a música tocando, “[ Início aqui” e “Fim aqui ]” marcam o trecho no ponto atual. O áudio original acompanha o trecho, e rearranjar a mesma música (motores, distribuição etc.) não perde a seleção.
- **Andamento** acelera ou desacelera a partitura (e o áudio original, que muda de tom junto).
- **Editar partitura:** uma linha por motor. `A4` é uma nota de 1 tempo, `C#5:0.5` meio tempo, `-:2` pausa de 2 tempos, `@0.5` muda a duração padrão, `v0.6` muda a intensidade, `|` separa compassos (só visual), `#` no início da linha é comentário.

Para ver os limites do motor: baixe a *Velocidade máxima* para ~300 RPM e toque *Engrenagens*; as notas agudas da melodia não são alcançadas (gráfico 4 e cartão “Acima da vel. máx.”). Suba a *Inércia* para ~20× e as notas passam a deslizar. Ponha *Micropassos* em 1/32: o som fica mais suave, mas as notas agudas estouram o limite de pulsos do driver. Com *Intensidade da ressonância* 1 e *Amortecimento* 0,05, notas perto da *Frequência de ressonância* fazem o motor perder passos e o som tremer.

## Da música do YouTube aos motores

1. **Download** com yt-dlp e conversão para WAV com ffmpeg (`server.py`).
2. **Transcrição** com o [basic-pitch](https://github.com/spotify/basic-pitch) (Spotify), um modelo de transcrição polifônica que roda localmente via ONNX Runtime (`transcribe.py`). A saída da rede vira notas (início, fim, altura MIDI, intensidade, curva de afinação) em três densidades: os limiares de ataque/quadro 0,5/0,3 (normal, o padrão da biblioteca), 0,35/0,2 (média) e 0,25/0,15 (alta). O pacote é instalado com `--no-deps` porque pediria TensorFlow, que não existe para Python 3.13. Três ajustes sobre a decodificação da biblioteca:
   - **Quebras falsas:** o basic-pitch corta notas contínuas em pedaços colados da mesma altura. Pedaços separados por até três quadros, com ataque abaixo de 0,7, são juntados. Uma queda real de energia seguida de ataque moderado preserva a repetição; a intensidade da nota unida é a média dos quadros, evitando promover uma sustentação por um único fragmento forte. Na avaliação original, antes dessa proteção de repetições, a união recuperou 93% das quebras falsas e juntou indevidamente 4% dos re-ataques reais.
   - **Notas rápidas:** uma segunda passagem recupera notas de 5–11 quadros (aproximadamente 58–128 ms) com ataque explícito. Usa os limiares da densidade escolhida, com pisos de 0,35 para ataque e 0,2 para energia; não aceita resíduos sem ataque nem duplica ou recorta eventos da primeira passagem. Isso inclui agudos suaves que ficavam fora do mínimo de duração. A versão 9 do cache exige nova análise dos caches antigos, reaproveitando o WAV.
   - **Curva de afinação:** o `get_pitch_bends` da biblioteca usa o pico do contorno (degraus de 1/3 de semitom) numa janela de ±8 semitons, que pega notas vizinhas. Aqui a curva é o centróide de 3 bins em volta do pico, numa janela de ±1,3 semitom, menos o desvio mediano da música. Esse desvio é sobretudo viés do modelo: +0,31 semitom em todas as notas do gabarito, que está afinado em Lá 440. No gabarito, a melodia com vibrato de ±0,3 semitom sai com curva em 100% das notas, e os instrumentos afinados retos ficam sem curva em 93–96%.
3. **Percussão** (`percussion.py`): separa o tonal do percussivo (HPSS na CQT) e transforma os picos do fluxo de energia por banda do componente percussivo em golpes de bumbo, caixa e chimbal.
4. **Distribuição** para N motores, no navegador (`arrangeMotors` em `score.mjs`).

Antes da transcrição, a análise verifica a afinação global em até 40 s distribuídos pela faixa. Um desvio de pelo menos 15 cents só é compensado quando pelo menos metade da energia dos picos fortes fica a até 10 cents da mesma afinação. A correção usa um WAV temporário com outra taxa de amostragem; os tempos das notas voltam à escala do original, que permanece intacto. Isso evita que uma nota entre dois semitons se divida em detecções fracas e picotadas. O cache de análise agora é versão 10; caches anteriores são refeitos ao transcrever, reaproveitando o WAV.

Em *Bergentrückung + ASGORE* (`PJ1yqbr8Y50`), o desvio estimado foi −38 cents. Com 4 motores, percussão, redução orquestral, densidade alta e as três opções de harmonia, compensar a afinação elevou a ocupação da primeira voz de 65,63% para 88,50%, e as pausas internas maiores que 150 ms passaram de 133 (52,41 s) para 48 (13,51 s). A comparação usa o mesmo áudio e arranjador, antes/depois da correção de afinação. Esses números medem continuidade, não acerto da melodia contra uma partitura; pausas musicais reais também entram na conta.

### Redução orquestral (melodia primeiro)

Modo pensado para reduzir texturas densas como [Test Drive, de Como Treinar o Seu Dragão](https://www.youtube.com/watch?v=IpPIK4T068s). O arranjador por intensidade × duração frequentemente gasta os primeiros motores com graves e acordes sustentados; o tema mais suave só aparece depois. A redução muda a prioridade de seleção, usando a mesma transcrição em cache:

- A primeira linha favorece notas no registro superior **da textura local**, ponderado pela intensidade e duração das vizinhas, sem faixa MIDI fixa. Considera notas ainda sustentadas e uma vizinhança de 500 ms antes/depois do ataque. Mantém a busca por uma cadeia contínua, aumenta o custo de saltos grandes e tolera melhor caudas que invadem a próxima nota da frase.
- Agudos muito fracos e isolados recebem menos prioridade. Uma sequência de notas vizinhas de intensidade semelhante é avaliada também em seu próprio registro: o acompanhamento forte não deve esconder toda a frase suave. Picos agudos curtos sem continuação têm menos prioridade ao competir com uma nota sustentada.
- Cópias mais fracas em oitavas ou a 19, 28 e 31 semitons, com início e fim próximos de uma nota grave mais forte, perdem prioridade; os três últimos intervalos exigem coincidência temporal mais estrita. A penalidade é retirada quando a vizinha aguda se move independentemente da voz grave, protegendo notas reais que coincidem ocasionalmente com um harmônico do acorde.
- A segunda linha recebe um bônus maior para o fundamento grave. A partir da terceira, dobramentos de oitava de ataques já representados valem menos, deixando espaço para outras notas do acorde. Nenhuma dessas notas é eliminada: motores adicionais ainda podem tocá-las.
- A recuperação de sustentações atua só entre as linhas de acompanhamento. A primeira linha permanece igual quando se adicionam ou removem motores, mantendo a frase no mesmo motor.

Para experimentar nessa faixa, use **Redução orquestral + Alta**, comece com **4 motores** e compare com 3 ou 6. Com percussão ligada, um deles toca a bateria; desligá-la libera mais uma voz tonal. O modo anterior continua no seletor para comparação. Não é necessário transcrever novamente.

É uma heurística de arranjo, não um detector treinado de melodia nem separação de instrumentos: pode confundir contracantos agudos com o tema, perder uma melodia muito grave ou suave e preferir a oitava inferior de um dobramento verdadeiro. Densidade alta não recupera notas que o transcritor não detectou. A redução não promete reproduzir com quatro motores toda a textura de doze.

O benchmark controlado de doze vozes (`tests/fixtures/dense-orchestra.mjs`) tem um tema mais suave que onze sustentações: o modo anterior só o inclui com doze motores; a redução o preserva inteiro no primeiro. É um caso sintético construído para testar esse problema, **não uma medida de acerto em Test Drive**. Na transcrição real da faixa, com densidade alta e quatro motores tonais, o registro médio do primeiro motor passa de MIDI 39,36 para 67,39, com ocupação de 92,72% para 89,67%. Isso confirma a mudança de seleção, mas, sem partitura de referência alinhada, não mede a fidelidade da melodia. A auditoria dos 18 caches locais cobre os dois modos e as três densidades, de 1 a 12 motores, sem ataques inventados ou sobreposição no mesmo motor.

Na API, use `arrangeMotors(job, motores, { method: 'melodia', density: 'alta' })` ou `dynamicLines(notas, motores, { melody: true })`. Os valores padrão dessas funções continuam compatíveis com o modo anterior; a interface escolhe explicitamente a redução.

### Harmonia e dobramentos

Três opções usam a harmonia para escolher melhor as notas, sem alterar a transcrição. Nas funções, ficam desligadas por padrão: `{ harmony, voicing, double }` em `dynamicLines` e `arrangeMotors`.

- **Notas fora da harmonia** (`harmony`, nos dois modos): a tonalidade local é estimada a cada 4 s, numa janela de 12 s, com os perfis de Krumhansl-Kessler e as notas fortes pesando mais. Notas abaixo de 0,45 de intensidade fora dessa tonalidade valem até 50% menos na seleção, a não ser que uma nota forte da mesma classe de altura soe perto delas (acorde emprestado, cromatismo dobrado em outra voz). Volume e afinação não mudam, e a nota continua disponível para motores extras. Fora da tonalidade não quer dizer errada: cromatismos fracos de verdade também perdem prioridade.
- **Acompanhamento pela função no acorde** (`voicing`, na redução): a partir do terceiro motor, uma nota cuja classe de altura já soa em outra linha vale 35% durante toda a sobreposição, mesmo sem ataque simultâneo. O trecho novo ganha 30% se for terça ou sétima acima da voz mais grave, que definem o acorde, e 15% nos outros intervalos; a quinta e o uníssono não ganham. A voz mais grave serve de aproximação da fundamental, sem detecção de acordes.
- **Dobrar a melodia** (`double`, na redução): a partir do terceiro motor, cópias da melodia uma oitava abaixo concorrem com as notas restantes, valendo 70% da nota original e tocando a 80% do volume. Um motor que só teria notas fracas reforça a melodia; num driver sem controle de corrente, como o A4988, o número de motores é o único volume. A cópia fica acima da segunda linha e nunca coincide com uma nota de mesma altura, escolhida ou não, nem atravessa o ataque de uma em legato. As cópias levam `double: true` e são os únicos ataques que não vêm da transcrição.

Medidas em 10 músicas do cache, redução orquestral, densidade alta, sem percussão (médias; sem gabarito):

| 3 motores tonais | Atual | `harmony` | `voicing` | `double` | Os três |
|---|---|---|---|---|---|
| Tempo da melodia fora do tom (%) | 4,7 | 3,4 | 4,7 | 4,7 | 3,4 |
| Tempo do acompanhamento fora do tom (%) | 6,4 | 4,4 | 7,7 | 6,3 | 4,8 |
| Voz interna dobrando outra voz (%) | 45,6 | 47,9 | 24,7 | 46,0 | 25,1 |
| Notas fortes cobertas por algum motor (%) | 85,7 | 85,5 | 88,7 | 84,9 | 88,2 |
| Melodia dobrada (% do tempo da melodia) | 0 | 0 | 0 | 6,1 | 6,3 |
| Pausas curtas no acompanhamento (por minuto) | 28,9 | 30,0 | 31,9 | 27,3 | 31,8 |

Com `harmony`, o primeiro motor toca a mesma nota de antes em 97,4% do tempo. Com cinco motores tonais e as três opções, a voz interna dobra outra voz em 45,9% do tempo (58,0% antes), as notas fortes cobertas passam de 95,8% para 96,9% e a melodia é dobrada em 16,3% do tempo. A tonalidade usada para medir é estimada pelo mesmo método da opção `harmony`, em janelas parecidas, então essa medida favorece a opção; "notas fortes cobertas" usa intensidade a partir de 0,35. Nada disso mede se as notas estão certas: a confirmação é de ouvido ou contra um gabarito.

Na faixa [DBZ Budokai 3 Opening (Instrumental)](https://www.youtube.com/watch?v=Et3NQPnxtqY), a revisão da transcrição e seleção foi comparada com a versão anterior, em densidade alta. O primeiro motor passou de 30 para 17 pausas maiores que 300 ms e de 34 para 19 saltos maiores que uma quinta separados por menos de 800 ms. O tempo tocado passou de 172,69 para 179,91 s. Por volta de 17 s, a sequência aguda já detectada deixa de ser substituída por notas graves. A contagem de pausas acima de 50 ms subiu de 115 para 119, com mais notas curtas recuperadas: não há melhora em toda medida de articulação. Esses dados descrevem o arranjo, sem uma partitura alinhada que comprove a identificação da guitarra em toda a música.

### Linhas dinâmicas

Nenhum motor tem papel fixo. Primeiro, o motor 1 recebe a cadeia de notas de maior valor na música inteira; essas notas saem da disputa, e o motor 2 recebe a melhor cadeia entre as que sobraram, e assim por diante (`dynamicLines`). O valor de uma cadeia é intensidade ponderada × tempo tocado, menos custos por salto maior que uma quinta e por interromper uma nota que ainda soaria; ela é achada por programação dinâmica sobre as notas. Depois, uma etapa de recuperação tenta mover notas cortadas para motores livres durante toda a sua duração original. Consequências:

- todo ataque do motor é um ataque real da música, e uma nota interrompida nunca volta (sem vai-e-volta);
- quem é melodia, baixo ou acompanhamento sai da otimização, não de faixas de altura escolhidas à mão;
- cada motor extra pega uma cadeia entre as notas restantes; pode ficar parado se só restarem trechos cujo valor não compensa os custos de transição;
- buracos de até 120 ms dentro de uma linha são preenchidos, limitados à metade da duração das notas vizinhas e a saltos de até uma quinta; assim, notas curtas mantêm o staccato e pausas entre registros distantes continuam audíveis;
- nota repetida colada vira re-ataque: o motor segue girando e o volume dá uma piscada de 30 ms. Abrir um silêncio pararia o motor, e a reaceleração soa como um "vai e volta" na altura.

Por padrão, uma etapa final troca continuações inteiras entre motores livres para reduzir saltos de altura, preservando exatamente as notas selecionadas e sem aumentar a quantidade de pausas de 30–300 ms. Ela não cria sustentações para preencher pausas. Na redução orquestral só reorganiza o acompanhamento, mantendo o primeiro motor estável. `{ continuity: false }` desliga essa etapa; a interface oferece a mesma comparação em *Manter frases no mesmo motor*.

O arranjo também trata três casos que desperdiçavam notas ou motores:

- **Passagens rápidas:** os 80 ms mínimos protegem notas longas contra cortes prematuros. Notas naturalmente mais curtas podem ser tocadas inteiras e seguir para a próxima, sem pular ataques de trinados ou arpejos.
- **Sustentações longas:** a busca considera todas as notas ainda ativas ou próximas da frase, sem descartar uma nota porque seu ataque aconteceu há mais de 12 segundos.
- **Uníssonos:** eventos da mesma altura e do mesmo instante ficam com o mais forte. Um novo ataque dessa altura encerra a cauda anterior; o legato também respeita esses ataques, mesmo quando estão em outro motor. Isso libera vozes para outras notas. A curva de vibrato mantém a escala de tempo original quando uma cauda é cortada.

Essas regras simplificam uníssonos de instrumentos diferentes para uma única voz de motor; não identificam instrumentos nem corrigem notas falsas do transcritor. As pausas mais conservadoras podem reduzir ligeiramente a cobertura temporal medida contra um gabarito, em troca de preservar a articulação.

**Saliência independente do volume:** a intensidade original do transcritor determina o valor da nota, antes do limite de volume. Assim, duas notas fortes que chegam ao mesmo volume máximo ainda podem ter valores diferentes. Para intensidade `a` entre 0 e 1, o valor por segundo é `(0,4 + 1,6a) × min(1; 0,25 + 1,25a)`: detecções abaixo de 0,6 perdem valor gradualmente, sem corte absoluto. Uma voz suave isolada continua podendo tocar. A intensidade não é uma probabilidade calibrada: notas verdadeiras fracas também podem perder prioridade. `{ salience: false }` recupera a pontuação baseada no volume.

**Recuperação de sustentações:** se uma nota foi cortada em mais de 100 ms e outro motor está livre desde o ataque original até o fim estimado, a nota inteira muda para esse motor. A busca prioriza caudas maiores/mais fortes e, entre motores disponíveis, prefere menores saltos para as notas vizinhas. Não cria re-ataques, não rouba vozes ocupadas e não prolonga além da transcrição. Preserva volume e curva de vibrato; recalcula a articulação no destino. Isso pode mudar qual motor executa uma nota da primeira linha. `{ sustain: false }` desliga a etapa. Caudas incorretas do transcritor também podem ser recuperadas; o limite é a qualidade da transcrição.

**Equilíbrio com poucos motores:** a segunda linha recebe um bônus gradual para notas abaixo da primeira linha que estiver soando no meio da nota candidata. O bônus começa abaixo de uma quinta e chega a 30% a 19 semitons de distância. Isso ajuda a manter o fundamento grave quando só há duas vozes tonais, sem impor uma faixa MIDI fixa, mudar a primeira linha ou reservar um motor obrigatoriamente para baixo. Se a primeira linha já é grave, ou está em silêncio, as outras notas continuam concorrendo normalmente. As demais linhas seguem o valor original. Nas funções `dynamicLines` e `arrangeMotors`, `{ balance: false }` desliga o bônus para comparação; não há mudança na interface.

Na avaliação isolada do equilíbrio (antes da saliência e recuperação), em duas renderizações sintéticas da composição de avaliação e uma transcrição anterior, com dois motores, a cobertura do baixo passou de 71,5% para 74,7%, de 75,6% para 87,0% e de 69,1% para 72,0%, respectivamente, sem alteração da cobertura da melodia. Com a saliência e recuperação, na renderização mais densa e dois motores, a cobertura de melodia passou de 84,22% para 88,10%, a de baixo de 86,97% para 93,09%, e a precisão temporal de alturas de 84,29% para 87,92%. Parte do acompanhamento perde espaço; com seis motores a precisão temporal caiu de 79,80% para 78,89%. Esses testes usam a mesma composição com timbres/transcrições diferentes; não demonstram uma melhora universal em músicas reais.

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
| `score.mjs` | afinação, partitura em texto, demonstrações, as três distribuições e a percussão |
| `physics.mjs` | modelo mecânico do motor (função pura) |
| `engine.mjs` | Web Audio: síntese, agendamento, transporte |
| `bells.mjs` | timbre de sinos: modos de vibração, golpes e caudas sobrepostas |
| `charts.mjs` | gráficos e rolo de notas |
| `app.mjs`, `index.html`, `style.css` | interface |
| `HARDWARE.md` | plano do protótipo físico: peças, protocolo, custos e roteiro |

## Verificação

    node --test tests/orchestra.test.mjs
    python3 -m unittest discover -s tests -p 'test_*.py'

Para incluir os testes da decodificação real do basic-pitch, execute também:

    ./run.sh -m unittest discover -s tests -p 'test_*.py'

Esses testes usam ativações controladas, sem baixar áudio nem executar a rede. Verificam recuperação de notas curtas e agudas suaves, conservação de sustentações e repetições, rejeição de resíduos sem ataque e preservação das matrizes originais. Sem numpy/basic-pitch, ficam marcados como ignorados na execução com o Python do sistema.

Cobre afinação, RPM, saturação de velocidade e de driver, inércia, perda de passos, partituras, as linhas dinâmicas (cadeias por motor, legato, repetição, passagens rápidas, sustentações longas, uníssonos e vibrato com caudas cortadas), a percussão e o arranjo por papéis.

Os testes Python usam apenas a biblioteca padrão, arquivos temporários e uma API local em porta livre. Cobrem recuperação de cache inválido, gravação atômica, falhas de disco, cópia interrompida de áudio e reaproveitamento de jobs em andamento, sem baixar vídeos nem executar o modelo de transcrição.

Para comparar o equilíbrio de vozes com uma partitura conhecida:

    node scripts/evaluate-arrangement.mjs notas.json gabarito.json media

`notas.json` usa o formato da transcrição (`notes`, opcionalmente `density`); o gabarito contém `tracks` de notas `{ start, end, midi }` ordenadas e `duration`. O relatório compara a versão anterior sem saliência/recuperação (`previous`), a atual sem equilíbrio (`unbalanced`), sem recuperação (`withoutSustain`), completa (`balanced`) e a redução orquestral (`melody`), com 1, 2, 3, 4, 6, 8 e 12 motores, sem percussão. Mede cobertura por voz de referência e precisão/recall de alturas numa grade de 10 ms, em porcentagem; não é F1 de ataques nem uma avaliação perceptiva. Não exige dependências externas.

Para reproduzir o benchmark de redução e descrever os arranjos da faixa real em todas as densidades:

    node scripts/benchmark-orchestral.mjs downloads/IpPIK4T068s/notes.json

Sem o argumento, roda apenas o caso sintético incluído no repositório. A gravação é opcional e depende do cache local. O relatório distingue cobertura contra o gabarito sintético das estatísticas sem gabarito da gravação real; todos os motores são tonais.

Para verificar os dois modos em todas as densidades do cache com 1, 2, 3, 4, 6, 8 e 12 motores:

    node scripts/audit-arrangements.mjs downloads

O auditor cobre as linhas dinâmicas e a redução, cada uma sem e com as opções de harmonia (na redução, com as três). Verifica ataques reais (as cópias da melodia precisam corresponder a uma nota do primeiro motor, uma oitava acima), notas monofônicas, ausência de uníssonos duplicados e conservação de notas, volume e vibrato na recuperação de caudas. Os segundos recuperados no relatório são a soma sobre todas as configurações, não uma duração única por música. Esses invariantes não medem se as notas da transcrição estão corretas.

Para isolar a redistribuição de frases, em densidade alta e 3, 4, 6, 8 e 12 motores tonais:

    node scripts/benchmark-continuity.mjs downloads

O relatório compara `continuity: false` com a opção ligada, contando pausas de 30–300 ms e saltos maiores que uma quinta dentro de 800 ms. Verifica que melodia, notas, durações, volumes e vibratos se conservam. Não mede reconhecimento de instrumentos nem qualidade perceptiva.

Use áudio que você tem direito de baixar e ouvir.
