"""Aplica o protótipo congelado às 34 faixas, sem inventar referência musical."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,'/tmp/motor-resolution-deps')
spec=importlib.util.spec_from_file_location('resolution_infer',Path(__file__).with_name('research-resolution-infer.py'))
inference=importlib.util.module_from_spec(spec);spec.loader.exec_module(inference)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();out=run/'existing';out.mkdir(exist_ok=True);(out/'candidates').mkdir(exist_ok=True)
    frozen,models=inference.load_models(run)
    prior=Path('downloads/research/harmonic-1794505637554')
    import numpy as np
    report=json.loads((out/'results.json').read_text()) if (out/'results.json').exists() else []
    done={r['id'] for r in report}
    for path in sorted((prior/'songs').glob('*.json')):
        if path.stem in done:continue
        song=json.loads(path.read_text());notes=song['density']['alta']
        job=dict(id=path.stem,duration=song['duration'],notes=notes)
        raw_path=Path('downloads/research/20261112T164100.748825Z')/path.stem/'basic-pitch-raw.npz'
        if raw_path.exists():
            with np.load(raw_path) as archive:raw={k:archive[k] for k in archive.files}
            times=raw['times'];extra=[]
            for a,b,p,amp,*_ in notes:
                i,j=np.searchsorted(times,[a,b]);j=max(i+1,j)
                lo,hi=np.searchsorted(times,[a-.05,a+.05]);hi=max(lo+1,hi)
                local=raw['contour'][i:j,max(0,3*(p-21)-2):3*(p-21)+3]
                centers=(local*np.arange(local.shape[1])).sum(axis=1)/(local.sum(axis=1)+1e-9)
                extra.append(dict(noteMean=float(raw['note'][i:j,p-21].mean()),onsetPeak=float(raw['onset'][lo:hi,p-21].max()),pitchStd=float(np.std(centers)/3),hasAcoustic=True))
            job['features']=extra
        frozen_path=out/'candidates'/path.name;frozen_path.write_text(json.dumps(job))
        sequences,timings=inference.predict(job,frozen,models)
        baseline=json.loads((prior/'validation'/f'{path.stem}-baseline.json').read_text())['tracks'][0]
        row=dict(id=path.stem,title=song['title'],hasRawAcousticFeatures=raw_path.exists(),timings=timings,
          warning='No musical reference: occupancy, gaps and changed pitches are descriptive only. Missing raw maps are explicitly marked; this is a domain shift.',
          baseline=[ [n['start'],n['end'],n['midi'],n['vel']] for n in baseline],methods=sequences)
        report.append(row)
        (out/'results.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        print(path.stem,len(notes),round(timings.get('totalSeconds',0),3),flush=True)


if __name__=='__main__':main()
