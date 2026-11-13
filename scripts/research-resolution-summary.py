"""Publica resultados portáteis, agregação por música, hashes e figura científica."""
import argparse
from datetime import datetime,timezone
import gzip
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import sys
sys.path.insert(0,'/tmp/motor-resolution-deps')
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
KEYS=['melodyCoverage','temporalPrecision','temporalRecall','temporalF1','notePrecision','noteRecall','noteF1',
 'onsetPitchPrecision','onsetPitchRecall','onsetPitchF1','onsetOnlyF1','falseSustainSeconds',
 'playedDuringSilenceSeconds','playedDuringSilenceFraction']


def mean(values):
    values=[v for v in values if v is not None]
    return float(np.mean(values)) if values else None


def aggregate(metrics):return {k:mean([m.get(k) for m in metrics]) for k in KEYS}


def ci(values):
    rng=np.random.default_rng(20261112);a=np.asarray(values)
    return list(map(float,np.quantile(np.mean(rng.choice(a,size=(2000,len(a)),replace=True),axis=1),[.025,.975]))) if len(a) else None


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);p.add_argument('--partial',action='store_true');args=p.parse_args()
    run=args.run.resolve();out=ROOT/'research/resolution';out.mkdir(parents=True,exist_ok=True)
    read=lambda p:json.loads(p.read_text())
    data=[read(p) for p in sorted((run/'evaluation').glob('*.json'))]
    prototypes={p.stem:read(p) for p in (run/'prototype').glob('*.json')}
    decomposition=read(run/'decomposition.json');dc={r['id']:r for r in decomposition}
    stress=read(run/'stress/results.json');existing=read(run/'existing/results.json')
    protocol=read(run/'protocol.json');frozen=read(run/'frozen-model.json');transcription=read(run/'transcription.json')
    guide_path=run/'multitask-guide-pop909/results.json'
    preparation=read(run/'preparation-loss.json')
    if not args.partial:
        assert len(data)==128 and len(prototypes)==64 and len(stress)==165 and len(existing)==34
        assert guide_path.exists() and len(read(guide_path)['cases'])==12
    summary=dict(createdUTC=datetime.now(timezone.utc).isoformat(),complete=not args.partial,
      run=str(run),protocol=protocol,frozenModel=frozen,dataset=read(run/'dataset.json'),
      note='Macro per song within each condition. Three renderings are repeated conditions of four held-out works, not twelve independent works. No perceptual reference for 34 cached real recordings.',
      testMetricsOpenedAfterFreeze=True,
      aggregates=[],partsByBudget=[],stress=[],bootstrapIntervals=[],timing={},sourceHashes={},artifacts={})
    summary['preparationLoss']=preparation
    for split in ['train','development','test']:
        for condition in sorted(set(r['condition'] for r in data)):
            rows=[r for r in data if r['split']==split and r['condition']==condition]
            if not rows:continue
            methods={'baseline':aggregate([r['baseline'][0]['melody'] for r in rows]),
              'oracleCoverageStrict':aggregate([dc[r['id']]['rawOracleCoverage']['metrics'] for r in rows]),
              'oracleEventF1Strict':aggregate([dc[r['id']]['rawOracleEventF1']['metrics'] for r in rows])}
            for method in ['hand','xgboost','xgboost_no_links','xgboost_no_existence']:
                found=[prototypes[r['id']]['methods'][method]['metrics'] for r in rows if r['id'] in prototypes]
                if found:methods[method]=aggregate(found)
            decomp={key:mean([dc[r['id']]['decomposition'][key]/dc[r['id']]['decomposition']['referenceNoteSeconds'] if dc[r['id']]['decomposition']['referenceNoteSeconds'] else None for r in rows]) for key in ['absentNoteSeconds','availableButUnselectedNoteSeconds','selectedCorrectAvailableSeconds','correctOutsideCandidateSupportSeconds']}
            decomp['lostToIntensityFilter']=mean([dc[r['id']]['filteredOutCorrectNoteSeconds']/dc[r['id']]['decomposition']['referenceNoteSeconds'] if dc[r['id']]['decomposition']['referenceNoteSeconds'] else None for r in rows])
            decomp['rawTemporalOracleCoverage']=mean([dc[r['id']]['decomposition']['temporalOracleCoverage'] for r in rows])
            summary['aggregates'].append(dict(split=split,condition=condition,songs=len(rows),methods=methods,decomposition=decomp))
            if split=='test' and all(r['id'] in prototypes for r in rows):
                values=[prototypes[r['id']]['methods']['xgboost']['metrics']['temporalF1']-r['baseline'][0]['melody']['temporalF1'] for r in rows]
                summary['bootstrapIntervals'].append(dict(condition=condition,quantity='xgboost minus baseline temporal F1',mean=mean(values),songBootstrap95=ci(values),resamples=2000,seed=20261112))
    for condition in ['clean','piano-equal','soft-reed','low-bright']:
        rows=[r for r in data if r['split']=='test' and r['condition']==condition]
        for i,motors in enumerate(protocol['budgets']):
            summary['partsByBudget'].append(dict(condition=condition,motors=motors,
              firstVoiceMelodyCoverage=mean([r['baseline'][i]['melody']['melodyCoverage'] for r in rows]),
              anyVoiceCoverage={part:mean([r['baseline'][i]['parts'][part]['melodyCoverage'] for r in rows]) for part in ['MELODY','BRIDGE','PIANO']}))
    for family in sorted(set(r['family'] for r in stress)):
        rows=[r for r in stress if r['family']==family]
        summary['stress'].append(dict(family=family,cases=len(rows),source=rows[0]['source'],
          ambiguous=all(r['ambiguous'] for r in rows),methods={name:aggregate([r['methods'][name]['metrics'] for r in rows]) for name in rows[0]['methods']}))
    guide=read(guide_path) if guide_path.exists() else None
    if guide:
        summary['multitaskGuide']={}
        for condition in ['piano-equal','soft-reed','low-bright']:
            rows=[r for r in guide['cases'] if r['id'].endswith(condition)]
            summary['multitaskGuide'][condition]={alpha:aggregate([r['outputs'][alpha]['metrics'] for r in rows]) for alpha in ['0','1']}
        summary['multitaskPop909']=read(run/'multitask-pop909/results.json')
    control_model=read(run/'multitask/results.json')
    summary['multitask']=control_model
    summary['multitaskValidation']=read(run/'multitask-validation/results.json')
    probes=ROOT/'downloads/research/resolution-source-metadata'
    summary['externalImpediments']=dict(lstom='No published checkpoint or scaling YAML in pinned repository/release list; not executed.',
      vocsepSDK=read(probes/'vocsep-artifact-probe.json'),vocsepAnonymousQuery=read(probes/'vocsep-anonymous-graphql.json'))
    base_times=[r['baseline'][i]['arrangerMilliseconds'] for r in data for i in range(7)]
    summary['timing'].update(baselineAllBudgetsMeanMilliseconds=mean(base_times),
      baselineN1MeanMilliseconds=mean([r['baseline'][0]['arrangerMilliseconds'] for r in data]),
      basicPitchInferenceTotalSeconds=sum(r['inferenceSeconds'] for r in transcription['measurements']),
      basicPitchDecodeTotalSeconds=sum(r['decodeSeconds'] for r in transcription['measurements']),
      basicPitchCumulativePeakRSSMiB=max(r['processPeakRSSMiBCumulative'] for r in transcription['measurements']),
      oraclePeakRSSMiBCumulative=max(r['processPeakRSSMiBCumulative'] for r in data),
      oracleEventMILPTotalSeconds=sum(r['oracleEventF1']['optimization']['seconds'] for r in data),
      allOraclesOptimal=all(r['oracleEventF1']['optimization']['optimal'] for r in data),
      prototypeCaseMeanSeconds=mean([r['timings']['totalSeconds'] for r in prototypes.values()]),
      prototypeCumulativePeakRSSMiB=max(r['timings']['processPeakRSSMiBCumulative'] for r in prototypes.values()))
    summary['versions']={name:importlib.metadata.version(name) for name in ['numpy','scipy','pretty-midi','basic-pitch','mir-eval','scikit-learn','xgboost-cpu']}
    for name in ['score.mjs','transcribe.py','requirements.txt']:
        summary['sourceHashes'][name]=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    summary['productionSourceUnchanged']=all(summary['sourceHashes'][name]==protocol['sourceHashes'][name] for name in ['score.mjs','transcribe.py'])
    payloads={'evaluation':data,'prototype':list(prototypes.values()),'decomposition':decomposition,'stress':stress,'existing':existing,
      'frozen-inputs':dict(candidates={p.stem:read(p) for p in (run/'candidates').glob('*.json')},reference={p.stem:read(p) for p in (run/'reference').glob('*.json')})}
    if guide:payloads['multitask-guide-pop909']=guide
    for name,payload in payloads.items():
        path=out/f'{name}.json.gz';path.write_bytes(gzip.compress(json.dumps(payload,ensure_ascii=False,allow_nan=False).encode(),mtime=0))
        summary['artifacts'][path.name]=dict(bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    snapshot=run/'phase3-source';snapshot.mkdir(exist_ok=True)
    sources=[*ROOT.glob('scripts/research-resolution-*.py'),*ROOT.glob('scripts/research_resolution_*.py'),
             ROOT/'scripts/research-resolution-baseline.mjs',ROOT/'tests/test_research_resolution.py']
    for path in sources:
        key=str(path.relative_to(ROOT));summary['sourceHashes'][key]=hashlib.sha256(path.read_bytes()).hexdigest()
        dest=snapshot/key;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
    (out/'models').mkdir(exist_ok=True)
    for path in (run/'models').glob('*.json'):shutil.copy2(path,out/'models'/path.name)
    os.environ['MPLCONFIGDIR']=str(run/'plot-cache');sys.path.insert(0,'/tmp/motor-resolution-plot')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plot_conditions=['piano-equal-symbolic','piano-equal','soft-reed','low-bright-symbolic','low-bright']
    labels=['Original: registro normal','BP: som dedilhado','BP: melodia suave','Original: melodia −12','BP: melodia −12, parciais fortes']
    selections=[]
    for condition in plot_conditions:
        a=next(x for x in summary['aggregates'] if x['split']=='test' and x['condition']==condition)
        d=a['decomposition'];selections.append([100*d[k] for k in ['selectedCorrectAvailableSeconds','availableButUnselectedNoteSeconds','absentNoteSeconds']])
    fig,ax=plt.subplots(figsize=(10,4.5),layout='constrained');left=np.zeros(len(labels))
    for values,color,title in zip(np.asarray(selections).T,['#26876c','#e6a447','#9aa1ac'],['Selecionado com suporte','Disponível, mas não selecionado','Ausente dos candidatos']):
        ax.barh(labels,values,left=left,color=color,label=title)
        for i,v in enumerate(values):
            if v>=4:ax.text(left[i]+v/2,i,f'{v:.1f}%',ha='center',va='center',fontsize=9,color='#132331')
        left+=values
    ax.set_xlim(0,100);ax.invert_yaxis();ax.set_xlabel('% do tempo de notas da melodia de referência')
    ax.set_title('Onde a melodia se perde? Mesmas quatro músicas de teste, trechos de 40 s')
    ax.legend(loc='upper center',bbox_to_anchor=(.5,-.17),ncol=3,frameon=False,fontsize=8)
    fig.savefig(out/'decomposicao-teste.svg');fig.savefig(out/'decomposicao-teste.png',dpi=160);plt.close(fig)
    (out/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False,allow_nan=False)+'\n')
    print(json.dumps(dict(complete=summary['complete'],conditions=len(data),prototypeCases=len(prototypes),stressCases=len(stress),existing=len(existing),productionSourceUnchanged=summary['productionSourceUnchanged'],timing=summary['timing']),indent=2))


if __name__=='__main__':main()
