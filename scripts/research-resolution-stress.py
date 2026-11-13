"""Reusa candidatos anteriores; nenhuma inferência Basic Pitch é repetida."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import importlib.util
sys.path.insert(0,'/tmp/motor-resolution-deps')
import numpy as np
from research_resolution_metrics import evaluate,temporal
spec=importlib.util.spec_from_file_location('resolution_infer',Path(__file__).with_name('research-resolution-infer.py'))
inference=importlib.util.module_from_spec(spec);spec.loader.exec_module(inference)
load_models,predict=inference.load_models,inference.predict


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();output=run/'stress';output.mkdir(exist_ok=False)
    for name in ['snapshot','candidates','reference','arrangements']:(output/name).mkdir()
    protocol=json.loads((run/'protocol.json').read_text())
    (output/'protocol.json').write_text(json.dumps({**protocol,'budgets':[1,2,3,4,6,8,12]}))
    shutil.copy2(run/'snapshot/score.mjs',output/'snapshot/score.mjs')
    old=json.loads(Path('research/harmonic-symbolic-2026-11-12.json').read_text())['cases']
    cases=[]
    for c in old:
        ident=f"symbolic-{c['family']}-{c['k']}"
        melody=c['lead'] or []
        remaining=[n for n in c['reference'] if n not in melody]
        cases.append(dict(id=ident,family=c['family'],source='previous-144',notes=c['notes'],
          duration=max(n[1] for n in c['notes'])+.25,parts=dict(MELODY=melody,BRIDGE=[],PIANO=remaining),ambiguous=c['lead'] is None))
    # Casos novos: cruzamento e pausas conhecidas, sem usar músicas de teste.
    for shift in [-12,0,12]:
        for dt in [.06,.15,.4]:
            melody=[[.1+i*dt,.1+(i+.8)*dt,60+shift+i,.5] for i in range(12) if i not in [4,5,10]]
            other=[[.1+i*dt,.1+(i+.8)*dt,74+shift-i,.65] for i in range(12)]
            cases.append(dict(id=f'crossing-rest-{shift}-{dt}',family='crossing-and-real-rests',source='new-symbolic',
              notes=sorted(melody+other),duration=.1+12*dt+.25,parts=dict(MELODY=melody,BRIDGE=other,PIANO=[]),ambiguous=False))
    acoustic=Path('downloads/research/multipitch-20261112')
    meta=json.loads((acoustic/'results.json').read_text())
    for c in meta['cases']:
        name=c['name'];notes=json.loads((acoustic/f'{name}-basic-pitch-events.json').read_text())
        raw=np.load(acoustic/f'{name}-basic-pitch.npz');times=raw['times'];extra=[]
        for a,b,p,amp in notes:
            i,j=np.searchsorted(times,[a,b]);j=max(i+1,j)
            lo,hi=np.searchsorted(times,[a-.05,a+.05]);hi=max(lo+1,hi)
            local=raw['contour'][i:j,max(0,3*(p-21)-2):3*(p-21)+3]
            centers=(local*np.arange(local.shape[1])).sum(axis=1)/(local.sum(axis=1)+1e-9)
            extra.append(dict(noteMean=float(raw['note'][i:j,p-21].mean()),onsetPeak=float(raw['onset'][lo:hi,p-21].max()),
                              pitchStd=float(np.std(centers)/3),hasAcoustic=True))
        melody=[] if c['ambiguous'] else c['lead']
        other=[n for n in c['reference'] if n not in melody]
        cases.append(dict(id='acoustic-'+name,family=name,source='previous-12-acoustic',notes=notes,features=extra,
          duration=2.8 if name[1:2]=='-' else 2.7,parts=dict(MELODY=melody,BRIDGE=[],PIANO=other),ambiguous=c['ambiguous']))
    for c in cases:
        (output/'candidates'/f"{c['id']}.json").write_text(json.dumps({k:c[k] for k in ['id','duration','notes','features'] if k in c}))
        (output/'reference'/f"{c['id']}.json").write_text(json.dumps(dict(id=c['id'],duration=c['duration'],parts=c['parts'])))
    subprocess.run(['node','scripts/research-resolution-baseline.mjs',str(output)],check=True,stdout=subprocess.DEVNULL)
    frozen,models=load_models(run);results=[]
    for c in cases:
        outputs,timings=predict(c,frozen,models)
        base=json.loads((output/'arrangements'/f"{c['id']}.json").read_text())['scores']
        methods={'baseline':base[0]['tracks'][0],**outputs}
        row={k:c[k] for k in ['id','family','source','ambiguous']}
        row.update(methods={name:dict(sequence=seq,metrics=evaluate(seq,c['parts']['MELODY'],c['duration'],c['notes'])) for name,seq in methods.items()},timings=timings)
        if c['ambiguous']:
            row['twoVoiceReferenceCoverage']=temporal([n for t in base[1]['tracks'] for n in t],c['parts']['PIANO'],c['duration'])['melodyCoverage']
        results.append(row)
    (output/'results.json').write_text(json.dumps(results,indent=2,allow_nan=False)+'\n')
    for family in sorted(set(c['family'] for c in cases)):
        rows=[r for r in results if r['family']==family]
        print(json.dumps(dict(family=family,cases=len(rows),coverage={name:float(np.mean([r['methods'][name]['metrics']['melodyCoverage'] for r in rows if r['methods'][name]['metrics']['melodyCoverage'] is not None])) for name in ['baseline','hand','xgboost'] if any(r['methods'][name]['metrics']['melodyCoverage'] is not None for r in rows)})),flush=True)


if __name__=='__main__':main()
