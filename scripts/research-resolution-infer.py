"""Aplica os modelos congelados e só então lê a referência para avaliação."""
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
from research_resolution_model import prepared_job,features,edges,edge_features,hand_scores,heuristic_affinity,select
from research_resolution_metrics import evaluate


def load_models(run):
    frozen=json.loads((run/'frozen-model.json').read_text())
    models={}
    for name,digest in frozen['hashes'].items():
        path=run/'models'/f'{name}.json'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==digest
        m=XGBClassifier(n_jobs=2);m.load_model(path);models[name]=m
    path=Path(__file__).with_name('research_resolution_model.py')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==frozen['sourceHashes'][path.name]
    return frozen,models


def predict(job,frozen,models):
    started=time.perf_counter();job=prepared_job(job)
    x=features(job);pairs=edges(job['notes']);ex=edge_features(job['notes'],x,pairs)
    feature_seconds=time.perf_counter()-started
    if not len(x):return {},{}
    qe=models['existence'].predict_proba(x)[:,1];qm=models['melody'].predict_proba(x)[:,1]
    affinity=models['affinity'].predict_proba(ex)[:,1] if len(ex) else np.empty(0)
    he,hm=hand_scores(x);ha=heuristic_affinity(ex)
    outputs={};timings={}
    for method,e,m,a,config in [
      ('hand',he,hm,ha,frozen['chosen']['hand']),
      ('xgboost',qe,qm,affinity,frozen['chosen']['xgboost']),
      ('xgboost_no_links',qe,qm,affinity,{**frozen['chosen']['xgboost'],'linkWeight':0}),
      ('xgboost_no_existence',np.ones(len(qe)),qm,affinity,frozen['chosen']['xgboost'])]:
        tick=time.perf_counter();outputs[method]=select(job['notes'],e,m,pairs,a,config['threshold'],config['linkWeight'])
        timings[method]=dict(selectionSeconds=time.perf_counter()-tick)
    timings.update(featureSeconds=feature_seconds,totalSeconds=time.perf_counter()-started,candidates=len(x),edges=len(ex),
      processPeakRSSMiBCumulative=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
    return outputs,timings


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path)
    p.add_argument('--splits',nargs='+',default=['development','test']);args=p.parse_args()
    run=args.run.resolve();frozen,models=load_models(run)
    songs={s['id']:s for s in json.loads((run/'protocol.json').read_text())['songs']}
    folder=run/'prototype';folder.mkdir(exist_ok=True)
    for path in sorted((run/'candidates').glob('*.json')):
        ident=path.stem;song=songs[ident.split('-')[0]]
        if song['split'] not in args.splits:continue
        dest=folder/path.name
        if dest.exists():continue
        outputs,timings=predict(json.loads(path.read_text()),frozen,models)
        # O resolvedor já terminou; somente o avaliador recebe as pistas originais.
        ref=json.loads((run/'reference'/path.name).read_text())
        row=dict(id=ident,split=song['split'],song=song['id'],condition=ident.split('-',1)[1],timings=timings,
          methods={name:dict(sequence=seq,metrics=evaluate(seq,ref['parts']['MELODY'],ref['duration'])) for name,seq in outputs.items()})
        dest.write_text(json.dumps(row,indent=2,allow_nan=False)+'\n')
        print(json.dumps(dict(id=ident,split=song['split'],methods={k:dict(coverage=v['metrics']['melodyCoverage'],noteF1=v['metrics']['noteF1'],onsetF1=v['metrics']['onsetPitchF1']) for k,v in row['methods'].items()})),flush=True)


if __name__=='__main__':main()
