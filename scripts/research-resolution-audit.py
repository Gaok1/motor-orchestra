"""Conferência final de integridade, separação de teste e contratos de eventos."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve();read=lambda p:json.loads(p.read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    protocol=read(run/'protocol.json');frozen=read(run/'frozen-model.json');summary=read(ROOT/'research/resolution/summary.json')
    assert summary['complete'] and summary['productionSourceUnchanged']
    assert digest(run/'protocol.json')==frozen['protocolSHA256']
    for name,value in frozen['hashes'].items():assert digest(run/'models'/f'{name}.json')==value
    assert digest(ROOT/'scripts/research_resolution_model.py')==frozen['sourceHashes']['research_resolution_model.py']
    groups=[{s['group'] for s in protocol['songs'] if s['split']==split} for split in ['train','development','test']]
    assert not any(a&b for i,a in enumerate(groups) for b in groups[i+1:])
    for key in ['score.mjs','transcribe.py']:assert digest(ROOT/key)==protocol['sourceHashes'][key]
    cases=oracle_count=sequence_count=0
    freeze_time=(run/'frozen-model.json').stat().st_mtime
    for path in (run/'evaluation').glob('*.json'):
        row=read(path);job=read(run/'candidates'/path.name);cases+=1
        if row['split']=='test':assert path.stat().st_mtime>=freeze_time
        for sequence in row['oracleSequences'].values():
            assert all(n in job['notes'] for n in sequence)
            assert all(a[1]<=b[0]+1e-9 for a,b in zip(sequence,sequence[1:]));oracle_count+=1
        proto=run/'prototype'/path.name
        if proto.exists():
            source={}
            for a,b,p,*_ in job['notes']:source[a,p]=max(b,source.get((a,p),b))
            for method in read(proto)['methods'].values():
                sequence=method['sequence']
                for a,b,p,*_ in sequence:assert (a,p) in source and a<b<=source[a,p]+1e-9
                assert all(a[1]<=b[0]+1e-9 for a,b in zip(sequence,sequence[1:]));sequence_count+=1
    assert cases==128 and oracle_count==256 and sequence_count==256
    guide=read(run/'multitask-guide-pop909/results.json')
    assert len(guide['cases'])==12 and all(c['alpha0MatchesFrozenBaseline'] for c in guide['cases'])
    for name,info in summary['artifacts'].items():assert digest(ROOT/'research/resolution'/name)==info['sha256']
    versions={}
    for name in ['lstom','vocsep','multitask-f0']:
        path=ROOT/'downloads/research/resolution-source-metadata'/name
        versions[name]=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()
    # Excluir o próprio índice e o cache de fontes para evitar circularidade.
    index={}
    for path in sorted(run.rglob('*')):
        relative=str(path.relative_to(run))
        if not path.is_file() or relative in ['artifact-index.json','audit.json'] or relative.startswith('plot-cache/'):continue
        index[relative]=dict(bytes=path.stat().st_size,sha256=digest(path))
    report=dict(validated=True,conditions=cases,strictOracleSequences=oracle_count,prototypeSequences=sequence_count,
      baselineFusionSequencesExactlyReproduced=12,splitGroupsDisjoint=True,productionUnchanged=True,
      modelFrozenBeforeTestEvaluation=True,externalRepoCommits=versions,
      mainEnvironmentOptionalPackages={name:bool(importlib.util.find_spec(name)) for name in ['tensorflow','torch','xgboost']},
      reportSHA256=digest(ROOT/'PESQUISA_RESOLUCAO_MELODICA.md'),artifactsIndexed=len(index))
    for name,data in [('artifact-index.json',index),('audit.json',report)]:
        value=json.dumps(data,indent=2,ensure_ascii=False)+'\n';(run/name).write_text(value);(ROOT/'research/resolution'/name).write_text(value)
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
