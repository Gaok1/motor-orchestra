"""Mede perda pela preparação do arranjador, sem repetir inferência ou oráculos."""
import argparse
import json
from pathlib import Path
from research_resolution_model import prepared_job
from research_resolution_metrics import temporal


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();rows=[]
    for path in (run/'evaluation').glob('*.json'):
        e=json.loads(path.read_text());job=json.loads((run/'candidates'/path.name).read_text())
        ref=json.loads((run/'reference'/path.name).read_text())
        raw=temporal([],ref['parts']['MELODY'],ref['duration'],job['notes'])
        prepared=temporal([],ref['parts']['MELODY'],ref['duration'],prepared_job(job)['notes'])
        rows.append(dict(id=e['id'],condition=e['condition'],split=e['split'],
          rawAvailability=raw['temporalOracleCoverage'],preparedAvailability=prepared['temporalOracleCoverage']))
    (run/'preparation-loss.json').write_text(json.dumps(rows,indent=2)+'\n')
    print('Measured preparation loss for',len(rows),'conditions.')


if __name__=='__main__':main()
