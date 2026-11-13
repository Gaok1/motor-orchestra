# Laboratório de escuta A/B

Abra **http://127.0.0.1:8002/**. A aplicação habitual permanece em http://127.0.0.1:8001/.

Este teste compara o arranjador atual com a mesma implementação acrescida de evidência melódica do modelo multitarefa. É a variante que apresentou ganhos mensurados em parte da pesquisa; ainda não é uma substituição aprovada. O classificador XGBoost que falhou nos contraexemplos não é usado aqui.

## Comparar

1. Escolha **MEGALOVANIA** ou **ASGORE** pelos botões.
2. Aperte **Tocar**. O laboratório começa com um motor e senoide para facilitar a escuta da primeira voz.
3. Em **Versão do arranjo**, alterne **Atual** e **Com guia (experimental)**. A troca mantém a posição e o trecho selecionado.
4. Experimente motores, sinos e mais vozes com os controles habituais. As duas versões usam as mesmas configurações.
5. Para repetir um trecho, arraste na linha do tempo ou use os marcadores de início/fim. O volume do áudio original permite consultar a gravação.

As duas músicas completas estão disponíveis. O laboratório usa candidatos e áudios congelados; não baixa músicas nem refaz Basic Pitch. Para outras músicas, esta versão de teste retorna uma mensagem de indisponibilidade.

## Isolamento e método

Nenhum arquivo do aplicativo habitual é substituído. A interface e o arranjador são copiados para `downloads/research/listening-guide-20261112/ui/`.

A prioridade da primeira voz recebe `4 × ativação melódica média` do modelo multitarefa, sem excluir candidatas ou criar ataques. O guia foi calculado no áudio completo; seus resultados podem diferir do processamento de um prefixo de 16 segundos. A consulta de frequência de ASGORE considera a compensação de −38 cents dos candidatos.

Não há gabarito alinhado dessas gravações. Esta página permite escuta comparativa; quantidade de notas e cobertura não são apresentadas como prova de fidelidade. A comparação de teste com referência está em [PESQUISA_RESOLUCAO_MELODICA.md](../PESQUISA_RESOLUCAO_MELODICA.md).

## Executar novamente

Na raiz do projeto:

```bash
# Só necessário se os guias completos ainda não existirem. Usa o ambiente
# TensorFlow isolado da pesquisa; pode levar alguns minutos em CPU.
./run.sh scripts/research-listening-lab.py prepare-guides

# Cria as cópias locais e os arquivos usados pelo navegador.
./run.sh scripts/research-listening-lab.py build

# Inicia apenas o servidor de teste.
./run.sh scripts/research-listening-lab.py serve
```

Os arquivos do laboratório, hashes e durações ficam em `downloads/research/listening-guide-20261112/manifest.json`. Guias brutos e tempos de execução ficam em `guides/`. As dependências e os pesos publicados são os mesmos descritos na pesquisa; nada foi instalado no ambiente principal.
