"""Ablação exploratória: adiciona suporte multitarefa à prioridade do baseline.

Alpha=1 e escala 4 são declarados, sem seleção de hiperparâmetros nos controles.
Não altera modelo congelado nem integra o guia ao aplicativo.
"""
import argparse
import json
from pathlib import Path
import subprocess
import numpy as np
from research_resolution_metrics import evaluate


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path)
    p.add_argument('--pop',action='store_true');args=p.parse_args()
    run=args.run.resolve();folder=run/('multitask-guide-pop909' if args.pop else 'multitask-guide');folder.mkdir(exist_ok=False)
    previous=Path('downloads/research/multipitch-20261112')
    controls=json.loads((previous/'controls.json').read_text());jobs=[];references={}
    for case in controls:
        name=case['name'];duration=2.8 if name[1:2]=='-' else 2.7
        notes=json.loads((previous/f'{name}-basic-pitch-events.json').read_text())
        references[name]=(case['lead'],duration,case['ambiguous'])
        jobs.append(dict(id=name,duration=duration,notes=notes,tuningCents=0))
    old=Path('downloads/research/20261112T164100.748825Z')
    for name in ['0FCvzsVlXpQ','PJ1yqbr8Y50']:
        source=json.loads((old/name/'notes.json').read_text())
        notes=[[a,min(b,16),p,s] for a,b,p,s,*_ in source['density']['alta'] if a<16]
        jobs.append(dict(id=name,duration=16,notes=notes,tuningCents=source.get('tuning_cents',0)))
    if args.pop:
        jobs=[];references={}
        for case in json.loads((run/'multitask-pop909/results.json').read_text())['cases']:
            ident=case['id'];job=json.loads((run/'candidates'/f'{ident}.json').read_text())
            reference=json.loads((run/'reference'/f'{ident}.json').read_text())
            jobs.append(dict(id=ident,duration=job['duration'],notes=job['notes'],tuningCents=0))
            references[ident]=(reference['parts']['MELODY'],reference['duration'],False)
    for job in jobs:
        raw=np.load(run/('multitask-pop909' if args.pop else 'multitask')/f"{job['id']}.npz");activation=raw['melody'];times=raw['times']
        support={}
        for pitch in sorted(set(n[2] for n in job['notes'])):
            frequency=440*2**((pitch-69)/12+job['tuningCents']/1200)
            index=round(60*np.log2(frequency/32.7))
            row=activation[max(0,index-1):min(360,index+2)].mean(axis=0) if 0<=index<360 else np.zeros(len(times))
            support[str(pitch)]=np.concatenate([[0],np.cumsum(row,dtype=np.float64)]).tolist()
        job.update(times=times.tolist(),prefixSupportByMidi=support)
    (folder/'inputs.json').write_text(json.dumps(jobs))
    source=(run/'snapshot/score.mjs').read_text();needle='n => leadPriority.get(n)'
    assert source.count(needle)==1
    (folder/'guided-score.mjs').write_text(source.replace(needle,'n => globalThis.__researchPriority(n, leadPriority.get(n))'))
    runner=r'''
import {readFileSync,writeFileSync} from 'node:fs';
import {arrangeMotors} from './guided-score.mjs';
const jobs=JSON.parse(readFileSync(new URL('./inputs.json',import.meta.url)));
const options={method:'melodia',density:'alta',threshold:.15,percussion:false,harmony:true,voicing:true,double:false};
const lowerBound=(xs,x)=>{let a=0,b=xs.length;while(a<b){const m=(a+b)>>1;if(xs[m]<x)a=m+1;else b=m;}return a;};
const rows=[];
for(const job of jobs){
 const support=n=>{const prefix=job.prefixSupportByMidi[String(n.midi)];const a=lowerBound(job.times,n.start),b=lowerBound(job.times,n.end);return prefix&&b>a?(prefix[b]-prefix[a])/(b-a):0;};
 const outputs={};
 for(const alpha of [0,1]){
  globalThis.__researchPriority=(note,original)=>original+alpha*4*support(note);
  const started=performance.now();const score=arrangeMotors({...job,density:{alta:job.notes}},1,options);
  outputs[String(alpha)]={milliseconds:performance.now()-started,sequence:score.tracks[0].map(n=>[n.start,n.end,n.midi,n.vel])};
 }
 rows.push({id:job.id,duration:job.duration,outputs});
}
writeFileSync(new URL('./arrangements.json',import.meta.url),JSON.stringify(rows));
'''
    (folder/'run.mjs').write_text(runner)
    subprocess.run(['node',str(folder/'run.mjs')],check=True)
    rows=json.loads((folder/'arrangements.json').read_text())
    for row in rows:
        if row['id'] in references:
            ref,duration,ambiguous=references[row['id']]
            row['ambiguous']=ambiguous
            for output in row['outputs'].values():output['metrics']=evaluate(output['sequence'],ref if not ambiguous else [],duration)
        if args.pop:
            frozen_baseline=json.loads((run/'arrangements'/f"{row['id']}.json").read_text())['scores'][0]['tracks'][0]
            assert row['outputs']['0']['sequence']==frozen_baseline,row['id']
            row['alpha0MatchesFrozenBaseline']=True
    report=dict(formula='originalPriority + alpha * 4 * meanMelodyActivation',alphas=[0,1],
      warning='Exploratory controls already known from research, not a new independent test or hyperparameter selection. No hard filtering, no candidate addition. Original audio frequency domain, ASGORE candidates mapped by -38 cents.',cases=rows)
    (folder/'results.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    for row in rows:
        print(row['id'],{k:v.get('metrics',{}).get('melodyCoverage') for k,v in row['outputs'].items()},flush=True)


if __name__=='__main__':main()
