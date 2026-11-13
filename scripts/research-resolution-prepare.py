"""Congela subconjunto POP909, divisão por obra e candidatos sem identidade de pista."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import random
import shutil
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[1]


def save(path,value):
    path.write_text(json.dumps(value,indent=2,ensure_ascii=False,allow_nan=False)+'\n')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('run',type=Path)
    args=p.parse_args()
    run=args.run.resolve();run.mkdir(parents=True,exist_ok=False)
    for d in ['midi','reference','candidates','raw','audio','arrangements','snapshot','models']: (run/d).mkdir()
    import pretty_midi
    meta=ROOT/'downloads/research/resolution-source-metadata'
    meta.mkdir(parents=True,exist_ok=True)
    pinned='d83e6edba6872a704f5d3b8b32f5cb540088dae6'
    metadata_path=meta/'POP909-Dataset.json'
    if not metadata_path.exists():
        url=f'https://api.github.com/repos/music-x-lab/POP909-Dataset/git/trees/{pinned}?recursive=1'
        req=urllib.request.Request(url,headers={'User-Agent':'motor-orchestra-research'})
        save(metadata_path,dict(tree=json.load(urllib.request.urlopen(req,timeout=40))))
    index_path=meta/'pop-index.xlsx'
    if not index_path.exists():
        index_path.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/music-x-lab/POP909-Dataset/{pinned}/POP909/index.xlsx',timeout=40).read())
    tree=json.loads((meta/'POP909-Dataset.json').read_text())['tree']
    commit=pinned
    z=zipfile.ZipFile(meta/'pop-index.xlsx');ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rows=ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('x:sheetData/x:row',ns)
    parsed=[]
    for row in rows:
        values=[]
        for c in row:
            if c.attrib.get('t')=='inlineStr': values.append(''.join(c.find('x:is',ns).itertext()))
            else:
                v=c.find('x:v',ns);values.append(v.text if v is not None else '')
        parsed.append(values)
    groups={}
    for row in parsed[1:]:
        if len(row)<3: continue
        group=unicodedata.normalize('NFKC',row[1]).strip().casefold()
        groups.setdefault(group,[]).append(dict(id=row[0].zfill(3),title=row[1],artist=row[2]))
    keys=sorted(groups);rng=random.Random(20261112);rng.shuffle(keys)
    songs=[]
    for i,key in enumerate(keys[:32]):
        s=sorted(groups[key],key=lambda x:x['id'])[0]
        split='train' if i<16 else 'development' if i<24 else 'test'
        # Seleção acústica declarada antes de abrir notas ou resultados.
        position=i if i<16 else i-16 if i<24 else i-24
        songs.append({**s,'group':key,'split':split,'synthesize':position<(8 if split=='train' else 4)})
    protocol=dict(seed=20261112,pop909Commit=commit,songs=songs,
      budgets=[1,2,3,4,6,8,12],options=dict(method='melodia',density='alta',threshold=.15,
      percussion=False,harmony=True,voicing=True,double=False,bends=False,mix=False),
      symbolicIntensity=.65,render=dict(seconds=40,startOffsetAfterFirstGlobalNote=8,sampleRate=22050,
      conditions=['piano-equal','soft-reed','low-bright']),
      metric=dict(onsetToleranceSeconds=.05,offsetRatio=.2,offsetMinimumSeconds=.05,exactMidi=True),
      policy='Train on train only, choose settings using development only; freeze models/configs before opening test metrics. No test tuning. Original references may overlap: retain them and report monophonic limits.',
      sourceHashes={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ['score.mjs','transcribe.py','PESQUISA_MELODIA.md','PESQUISA_RESULTADOS.md','PESQUISA_HARMONICA.md']})
    save(run/'protocol.json',protocol)
    for name in ['score.mjs','transcribe.py']: shutil.copy2(ROOT/name,run/'snapshot'/name)
    def download(song):
        ident=song['id'];folder=run/'midi'/ident;folder.mkdir()
        for name in [f'{ident}.mid','beat_midi.txt']:
            url=f'https://raw.githubusercontent.com/music-x-lab/POP909-Dataset/{commit}/POP909/{ident}/{name}'
            (folder/name).write_bytes(urllib.request.urlopen(url,timeout=40).read())
        return ident
    with ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(download,songs))
    manifest=[]
    for s in songs:
        ident=s['id'];path=run/'midi'/ident/f'{ident}.mid'
        midi=pretty_midi.PrettyMIDI(str(path))
        ref={name:[] for name in ['MELODY','BRIDGE','PIANO']}
        for inst in midi.instruments:
            name=inst.name.strip().upper()
            if name not in ref: raise ValueError((ident,inst.name))
            ref[name].extend([[float(n.start),float(n.end),int(n.pitch),int(n.velocity)] for n in inst.notes if n.end>n.start])
        for events in ref.values(): events.sort(key=lambda n:(n[0],n[2],n[1]))
        duration=max(n[1] for events in ref.values() for n in events)
        # Identidades existem só no arquivo de referência, nunca no candidato.
        notes=sorted([[a,b,p,.65] for events in ref.values() for a,b,p,v in events],key=lambda n:(n[0],n[2],n[1]))
        save(run/'reference'/f'{ident}-clean.json',dict(id=ident,duration=duration,parts=ref))
        save(run/'candidates'/f'{ident}-clean.json',dict(id=f'{ident}-clean',duration=duration,notes=notes))
        manifest.append({**s,'duration':duration,'counts':{k:len(v) for k,v in ref.items()},
                         'midiSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),
                         'candidateSHA256':hashlib.sha256((run/'candidates'/f'{ident}-clean.json').read_bytes()).hexdigest()})
    save(run/'dataset.json',manifest)
    print(json.dumps(dict(run=str(run),songs=len(songs),midiBytes=sum((run/'midi'/s['id']/f"{s['id']}.mid").stat().st_size for s in songs),splits={x:[s['id'] for s in songs if s['split']==x] for x in ['train','development','test']}),indent=2))


if __name__=='__main__':main()
