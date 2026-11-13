"""Avalia baseline e oráculos; mantém resultados de teste fechados até o congelamento."""
import argparse
import json
from pathlib import Path
import resource
import time
from research_resolution_metrics import evaluate,temporal,oracle_coverage,oracle_event_f1


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path)
    p.add_argument('--splits',nargs='+',default=['train','development']);args=p.parse_args()
    run=args.run.resolve();output=run/'evaluation';output.mkdir(exist_ok=True)
    protocol=json.loads((run/'protocol.json').read_text());songs={s['id']:s for s in protocol['songs']}
    if 'test' in args.splits and not (run/'frozen-model.json').exists():raise RuntimeError('Congele modelo/config antes de abrir métricas de teste')
    for path in sorted((run/'candidates').glob('*.json')):
        ident=path.stem;song=songs.get(ident.split('-')[0])
        if not song or song['split'] not in args.splits:continue
        dest=output/f'{ident}.json'
        if dest.exists():continue
        scores_path=run/'arrangements'/path.name
        if not scores_path.exists():continue
        job=json.loads(path.read_text());ref=json.loads((run/'reference'/path.name).read_text())
        candidates=[n for n in job['notes'] if n[3]>=protocol['options']['threshold']]
        melody=ref['parts']['MELODY'];duration=ref['duration']
        row=dict(id=ident,song=song['id'],split=song['split'],condition=ident.split('-',1)[1],duration=duration,
          candidates=len(candidates),melodyReferenceEvents=len(melody),
          melodyPolyphonicNoteSeconds=temporal(melody,melody,duration)['referenceNoteSeconds'],baseline=[])
        started=time.perf_counter()
        arrangements=json.loads(scores_path.read_text())['scores']
        for score in arrangements:
            parts={name:temporal([n for track in score['tracks'] for n in track],part,duration) for name,part in ref['parts'].items()}
            row['baseline'].append(dict(motors=score['motors'],melody=evaluate(score['tracks'][0],melody,duration,candidates),
                                        parts=parts,arrangerMilliseconds=score['milliseconds']))
        row['baselineEvaluationSeconds']=time.perf_counter()-started
        started=time.perf_counter();oc=oracle_coverage(candidates,melody)
        row['oracleCoverage']=dict(metrics=evaluate(oc,melody,duration,candidates),seconds=time.perf_counter()-started)
        oe,info=oracle_event_f1(candidates,melody)
        row['oracleEventF1']=dict(metrics=evaluate(oe,melody,duration,candidates),optimization=info)
        # As sequências são auditáveis e só contêm eventos integrais dos candidatos.
        row['oracleSequences']=dict(coverage=oc,eventF1=oe)
        row['processPeakRSSMiBCumulative']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
        dest.write_text(json.dumps(row,indent=2,allow_nan=False)+'\n')
        b=row['baseline'][0]['melody']
        print(json.dumps(dict(id=ident,split=song['split'],coverage=b['melodyCoverage'],available=b['temporalOracleCoverage'],
          strictOracleCoverage=row['oracleCoverage']['metrics']['melodyCoverage'],noteF1=b['noteF1'],
          oracleNoteF1=row['oracleEventF1']['metrics']['noteF1'],oracleOptimal=info['optimal'])),flush=True)


if __name__=='__main__':main()
