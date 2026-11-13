"""Treina apenas no treino; seleciona parâmetros no desenvolvimento e congela."""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import sys
import time
sys.path.insert(0,'/tmp/motor-resolution-deps')
import numpy as np
from xgboost import XGBClassifier
from research_resolution_model import FEATURES,prepared_job,features,labels,edges,edge_features,hand_scores,heuristic_affinity,select
from research_resolution_metrics import evaluate


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();stamp=run/'frozen-model.json'
    if stamp.exists():raise RuntimeError('Modelo já congelado: não ajustar após abrir teste')
    started=time.perf_counter();protocol=json.loads((run/'protocol.json').read_text())
    songs={s['id']:s for s in protocol['songs']}
    cached=run/'features';cached.mkdir(exist_ok=True)
    collection=[]
    for path in sorted((run/'candidates').glob('*.json')):
        ident=path.stem;song=songs[ident.split('-')[0]]
        if song['split']=='test':continue
        job=prepared_job(json.loads(path.read_text()));ref=json.loads((run/'reference'/path.name).read_text())
        x=features(job);ye,ym,anchors=labels(job['notes'],ref)
        pairs=edges(job['notes']);ex=edge_features(job['notes'],x,pairs)
        ey=np.asarray([int(anchors[j]>=0 and (anchors[i]==anchors[j]+1 or anchors[i]==anchors[j] and job['notes'][i][0]-job['notes'][j][1]<.25)) for j,i in pairs])
        np.savez_compressed(cached/f'{ident}.npz',x=x,existence=ye,melody=ym,anchors=anchors,
                            pairs=np.asarray(pairs),edgeX=ex,edgeY=ey)
        collection.append(dict(id=ident,split=song['split'],job=job,ref=ref,x=x,ye=ye,ym=ym,pairs=pairs,ex=ex,ey=ey))
        print('FEATURES',ident,len(x),len(ex),flush=True)
    train=[c for c in collection if c['split']=='train'];dev=[c for c in collection if c['split']=='development']
    x=np.concatenate([c['x'] for c in train]);ye=np.concatenate([c['ye'] for c in train]);ym=np.concatenate([c['ym'] for c in train])
    weights=np.concatenate([np.full(len(c['x']),1/max(1,len(c['x']))) for c in train]);weights*=len(weights)/sum(weights)
    config=dict(n_estimators=220,max_depth=3,learning_rate=.05,min_child_weight=10,
                subsample=1,colsample_bytree=1,random_state=20261112,n_jobs=2,tree_method='hist',objective='binary:logistic')
    fit_start=time.perf_counter()
    existence=XGBClassifier(**config).fit(x,ye,sample_weight=weights)
    melody=XGBClassifier(**config).fit(x[ye==1],ym[ye==1],sample_weight=weights[ye==1])
    rng=np.random.default_rng(20261112);edge_x=[];edge_y=[]
    for c in train:
        positive=np.flatnonzero(c['ey']);negative=np.flatnonzero(c['ey']==0)
        negative=rng.choice(negative,min(len(negative),max(1000,4*len(positive))),replace=False)
        chosen=np.concatenate([positive,negative]);edge_x.append(c['ex'][chosen]);edge_y.append(c['ey'][chosen])
    ex=np.concatenate(edge_x);ey=np.concatenate(edge_y)
    affinity=XGBClassifier(**{**config,'n_estimators':120,'max_depth':2}).fit(ex,ey)
    fit_seconds=time.perf_counter()-fit_start
    for name,model in [('existence',existence),('melody',melody),('affinity',affinity)]:model.save_model(run/'models'/f'{name}.json')
    trials=[];chosen={}
    for method in ['hand','xgboost']:
        scored=[]
        for c in dev:
            if method=='hand':qe,qm=hand_scores(c['x']);aff=heuristic_affinity(c['ex'])
            else:qe=existence.predict_proba(c['x'])[:,1];qm=melody.predict_proba(c['x'])[:,1];aff=affinity.predict_proba(c['ex'])[:,1] if len(c['ex']) else np.empty(0)
            scored.append((c,qe,qm,aff))
        for threshold in [.2,.35,.5]:
            for link in [0,.03,.1]:
                values=[]
                for c,qe,qm,aff in scored:
                    sequence=select(c['job']['notes'],qe,qm,c['pairs'],aff,threshold,link)
                    metrics=evaluate(sequence,c['ref']['parts']['MELODY'],c['ref']['duration'])
                    if metrics['temporalF1'] is not None:values.append((c['id'].split('-')[0],(metrics['temporalF1']+metrics['onsetPitchF1'])/2))
                # Cada música tem peso igual; três renderizações contam como
                # condições da mesma música e não três obras independentes.
                by_song={}
                for song_id,value in values:by_song.setdefault(song_id,[]).append(value)
                objective=float(np.mean([np.mean(v) for v in by_song.values()]))
                trials.append(dict(method=method,threshold=threshold,linkWeight=link,developmentObjective=objective))
        chosen[method]=max([t for t in trials if t['method']==method],key=lambda t:t['developmentObjective'])
    result=dict(seed=20261112,trainingCases=[c['id'] for c in train],developmentCases=[c['id'] for c in dev],
      testMetricsOpened=False,features=FEATURES,xgboostConfig=config,chosen=chosen,developmentTrials=trials,
      labelPolicy='existence: >=50% candidate duration supported by any reference pitch; melody role trained only on existing candidates; affinity: consecutive MELODY reference events or fragments of same MELODY event.',
      trainSamples=dict(nodes=len(x),existing=int(sum(ye)),melody=int(sum(ym[ye==1])),edges=len(ex),positiveEdges=int(sum(ey))),
      seconds=dict(total=time.perf_counter()-started,fit=fit_seconds),
      processPeakRSSMiBCumulative=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
      featureImportance=dict(existence=dict(zip(FEATURES,map(float,existence.feature_importances_))),melody=dict(zip(FEATURES,map(float,melody.feature_importances_)))),
      hashes={f:hashlib.sha256((run/'models'/f'{f}.json').read_bytes()).hexdigest() for f in ['existence','melody','affinity']},
      sourceHashes={f:hashlib.sha256(Path(__file__).with_name(f).read_bytes()).hexdigest() for f in ['research-resolution-train.py','research_resolution_model.py']},
      protocolSHA256=hashlib.sha256((run/'protocol.json').read_bytes()).hexdigest())
    stamp.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k in ['chosen','trainSamples','seconds','processPeakRSSMiBCumulative']}),flush=True)


if __name__=='__main__':main()
