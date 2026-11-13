"""Cria a condição simbólica limpa dos MESMOS trechos e transposições sintetizados."""
import argparse
import json
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();count=0
    report=json.loads((run/'transcription.json').read_text())
    for row in report['measurements']:
        source=run/'reference'/f"{row['id']}.json";ident=row['id']+'-symbolic'
        reference=json.loads(source.read_text());reference['id']=ident
        notes=sorted([[a,b,p,.65] for events in reference['parts'].values() for a,b,p,*_ in events],key=lambda n:(n[0],n[2],n[1]))
        path=run/'candidates'/f'{ident}.json'
        if path.exists():raise RuntimeError(f'Não sobrescrever {path}')
        path.write_text(json.dumps(dict(id=ident,duration=reference['duration'],notes=notes)))
        (run/'reference'/path.name).write_text(json.dumps(reference))
        count+=1
    print('Matched clean conditions:',count)


if __name__=='__main__':main()
