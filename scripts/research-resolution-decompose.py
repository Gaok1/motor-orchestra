"""Separa falta na decodificação, filtro de intensidade e seleção, nos mesmos trechos."""
import argparse
import json
from pathlib import Path
from research_resolution_metrics import evaluate,temporal,oracle_coverage,oracle_event_f1


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();rows=[]
    for file in sorted((run/'evaluation').glob('*.json')):
        prior=json.loads(file.read_text());job=json.loads((run/'candidates'/file.name).read_text())
        ref=json.loads((run/'reference'/file.name).read_text());melody=ref['parts']['MELODY'];duration=ref['duration']
        baseline=json.loads((run/'arrangements'/file.name).read_text())['scores'][0]['tracks'][0]
        decomposition=temporal(baseline,melody,duration,job['notes'])
        filtered_available=prior['baseline'][0]['melody']['availableCorrectNoteSeconds']
        row={k:prior[k] for k in ['id','song','split','condition']}
        row.update(decomposition=decomposition,filteredOutCorrectNoteSeconds=max(0,decomposition['availableCorrectNoteSeconds']-filtered_available),
                   rawCandidates=len(job['notes']),eligibleCandidates=prior['candidates'])
        if len(job['notes'])==prior['candidates']:
            row.update(rawOracleCoverage=prior['oracleCoverage'],rawOracleEventF1=prior['oracleEventF1'])
        else:
            sequence=oracle_coverage(job['notes'],melody)
            row['rawOracleCoverage']=dict(metrics=evaluate(sequence,melody,duration,job['notes']),sequence=sequence)
            sequence,info=oracle_event_f1(job['notes'],melody)
            row['rawOracleEventF1']=dict(metrics=evaluate(sequence,melody,duration,job['notes']),optimization=info,sequence=sequence)
        if prior['condition']!='clean' and not prior['condition'].endswith('-symbolic'):
            # Somente a avaliação polifônica usa todas as partes como verdade.
            # Duplicatas exatas de uníssono entre pistas contam como um evento.
            union=sorted({tuple(n[:3]) for part in ref['parts'].values() for n in part})
            row['polyphonicTranscription']=evaluate(job['notes'],union,duration)
        rows.append(row)
    (run/'decomposition.json').write_text(json.dumps(rows,indent=2,allow_nan=False)+'\n')
    print('Decomposed',len(rows),'conditions. Raw oracle is before UI intensity filtering.')


if __name__=='__main__':main()
