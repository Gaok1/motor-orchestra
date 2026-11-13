"""Laboratório A/B isolado: mesma interface, guia opcional e caches só de leitura.

./run.sh scripts/research-listening-lab.py build
./run.sh scripts/research-listening-lab.py serve
"""
import argparse
from datetime import datetime,timezone
import hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import shutil
import subprocess
from urllib.parse import parse_qs,urlsplit

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'downloads/research/listening-guide-20261112'
FROZEN=ROOT/'downloads/research/20261112T164100.748825Z'
SONGS={'0FCvzsVlXpQ':'MEGALOVANIA','PJ1yqbr8Y50':'ASGORE'}


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_guides(folder):
    runtime=Path('/tmp/motor-resolution-tf/bin/python')
    if not runtime.exists():raise RuntimeError('Prepare o ambiente isolado TensorFlow conforme PESQUISA_RESOLUCAO_MELODICA.md.')
    source=(ROOT/'scripts/research-resolution-multitask.py').read_text()
    needle="jobs.append(dict(id=ident,path=old/ident/'audio.wav',duration=16,lead=None,ambiguous=False))"
    assert source.count(needle)==1
    worker=folder/'full-guide-worker.py'
    worker.write_text(source.replace(needle,"jobs.append(dict(id=ident,path=old/ident/'audio.wav',duration=None,lead=None,ambiguous=False))"))
    (folder/'guides').mkdir(exist_ok=True)
    subprocess.run([str(runtime),str(worker),str(ROOT/'downloads/research/resolution-20261112'),
      '--repo',str(ROOT/'downloads/research/resolution-source-metadata/multitask-f0'),
      '--only',*SONGS,'--output',str(folder/'guides'),'--resume'],cwd=ROOT,check=True)


def build(folder,guide_dir):
    import numpy as np
    ui=folder/'ui';ui.mkdir(exist_ok=True)
    for name in ['index.html','app.mjs','engine.mjs','physics.mjs','bells.mjs','charts.mjs','style.css']:
        shutil.copy2(ROOT/name,ui/name)
    score=(ROOT/'score.mjs').read_text();needle='n => leadPriority.get(n)'
    assert score.count(needle)==1
    (ui/'baseline-score.mjs').write_text(score)
    (ui/'guided-score.mjs').write_text(score.replace(needle,'n => globalThis.__listeningPriority(n, leadPriority.get(n))'))
    (ui/'score.mjs').write_text('''
export * from './baseline-score.mjs';
import {arrangeMotors as baseline} from './baseline-score.mjs';
import {arrangeMotors as guided} from './guided-score.mjs';
let guide=null;
export function setMelodyGuide(next){ guide=next; }
const lowerBound=(xs,x)=>{let a=0,b=xs.length;while(a<b){const m=(a+b)>>1;if(xs[m]<x)a=m+1;else b=m;}return a;};
export function guideSupport(note){
  if(!guide)return 0;
  const prefix=guide.prefix[String(note.midi)];
  const a=lowerBound(guide.times,note.start),b=lowerBound(guide.times,note.end);
  return prefix&&b>a?(prefix[b]-prefix[a])/(b-a):0;
}
export function arrangeMotors(job,motors,options={}){
  if(!options.melodyGuide||options.method!=='melodia')return baseline(job,motors,options);
  if(!guide||guide.id!==job.id)throw Error('O guia desta música ainda não foi carregado.');
  globalThis.__listeningPriority=(note,original)=>original+4*guideSupport(note);
  return guided(job,motors,options);
}
''')
    manifest=dict(createdUTC=datetime.now(timezone.utc).isoformat(),formula='originalPriority + 4 * meanMelodyActivation',
      workerSHA256=sha(folder/'full-guide-worker.py') if (folder/'full-guide-worker.py').exists() else None,
      baselineSHA256=sha(ROOT/'score.mjs'),sourceHashes={name:sha(ROOT/name) for name in ['index.html','app.mjs','engine.mjs','physics.mjs','bells.mjs','charts.mjs','style.css']},songs=[])
    for ident,title in SONGS.items():
        npz=guide_dir/f'{ident}.npz'
        with np.load(npz) as archive:times=archive['times'];activation=archive['melody']
        job=json.loads((FROZEN/ident/'notes.json').read_text())
        available=float(times[-1]+256/22050)
        if available<job['duration']-.1:
            job['duration']=min(available,16)
            for key in ['notes']:
                job[key]=[[a,min(b,job['duration']),*rest] for a,b,*rest in job[key] if a<job['duration']]
            job['density']={key:[[a,min(b,job['duration']),*rest] for a,b,*rest in events if a<job['duration']] for key,events in job['density'].items()}
            job['drums']=[d for d in job['drums'] if d[0]<job['duration']]
        prefix={}
        for pitch in sorted({n[2] for events in [job['notes'],*job['density'].values()] for n in events}):
            frequency=440*2**((pitch-69)/12+job.get('tuning_cents',0)/1200)
            index=round(60*np.log2(frequency/32.7))
            values=activation[max(0,index-1):min(360,index+2)].mean(axis=0) if 0<=index<360 else np.zeros(len(times))
            prefix[str(pitch)]=np.concatenate([[0],np.cumsum(values,dtype=np.float64)]).tolist()
        guide=dict(id=ident,times=times.tolist(),prefix=prefix)
        job_file=folder/f'{ident}-job.json';guide_file=folder/f'{ident}-guide.json'
        job_file.write_text(json.dumps(job,ensure_ascii=False));guide_file.write_text(json.dumps(guide,separators=(',',':')))
        manifest['songs'].append(dict(id=ident,title=title,duration=job['duration'],originalDuration=json.loads((FROZEN/ident/'notes.json').read_text())['duration'],
          audio=str(FROZEN/ident/'audio.wav'),jobSHA256=sha(job_file),guideSHA256=sha(guide_file),rawGuideSHA256=sha(npz)))
    html=(ui/'index.html').read_text().replace('<title>Sinfonia de Motores</title>','<title>Sinfonia · Comparação A/B</title>')
    html=html.replace('<h1>Sinfonia de Motores</h1>','<h1>Sinfonia · Comparação A/B</h1>')
    intro='Cada motor toca uma nota por vez, acionado por pulsos. Cole um link do YouTube para transcrever a música e arranjá-la para os motores (melodia, harmonia e baixo), ou use uma das demonstrações.'
    html=html.replace(intro,'Escolha uma música e alterne entre Atual e Com guia enquanto ela toca. O ponto da música, o timbre e a quantidade de motores são mantidos. Esta versão é experimental.')
    choices=''.join(f'<button type="button" class="secondary" data-lab-song="{ident}">{title} · {next(s["duration"] for s in manifest["songs"] if s["id"]==ident):.0f}s</button>' for ident,title in SONGS.items())
    html=html.replace('<form id="link-form" novalidate>',f'<div class="sources" aria-label="Músicas disponíveis">{choices}</div><form id="link-form" novalidate>')
    html=html.replace('Música do YouTube</label>','Música deste teste</label>').replace('>Transcrever</button>','>Carregar</button>')
    html=html.replace('<div id="youtube-controls" class="youtube-controls" hidden>','''<div id="youtube-controls" class="youtube-controls" hidden>
          <label id="lab-version-label">Versão do arranjo
            <select id="lab-version"><option value="current">Atual</option><option value="guide" selected>Com guia (experimental)</option></select>
          </label>''')
    html=html.replace('data-model="ideal" role="radio" aria-checked="false"','data-model="ideal" role="radio" aria-checked="true" class="on"')
    html=html.replace('data-model="mech" role="radio" aria-checked="true" class="on"','data-model="mech" role="radio" aria-checked="false"')
    (ui/'index.html').write_text(html)
    app=(ui/'app.mjs').read_text().replace('DEMOS, arrangeMotors, mtof','DEMOS, arrangeMotors, setMelodyGuide, mtof')
    app=app.replace('const engine = new Engine();',"const engine = new Engine();\nengine.model = 'ideal';")
    app=app.replace("  $('reduction-options').hidden = method !== 'melodia';","  $('reduction-options').hidden = method !== 'melodia';\n  $('lab-version-label').hidden = method !== 'melodia';")
    app=app.replace("    method, threshold, density:","    melodyGuide: $('lab-version').value === 'guide',\n    method, threshold, density:")
    app=app.replace("$('method').addEventListener('change', () => useYoutube(false));","$('method').addEventListener('change', () => useYoutube(false));\n$('lab-version').addEventListener('change', () => useYoutube(false));")
    app=app.replace("    job = result;","    const guideResponse = await fetch(`/guide/${result.id}`);\n    if (!guideResponse.ok) throw Error('O guia desta música não está disponível.');\n    setMelodyGuide(await guideResponse.json());\n    job = result;")
    old="    setStatus(`Pronto: “${result.title}”. Aperte Tocar. Troque a distribuição para comparar os métodos; mais motores = mais vozes.`);"
    app=app.replace(old,"    setStatus(`Pronto: “${result.title}”. Aperte Tocar e alterne a versão. Para ouvir só a melodia, mantenha um motor.`);")
    app=app.replace('for (const midi of [69, 73, 76]) addMotor(midi);','for (const midi of [69]) addMotor(midi);')
    app=app.replace("setStatus('Clique em “Acorde de Lá maior” ou em “▶ Nota” de um motor para ouvir. O áudio começa no primeiro clique.');","setStatus('Escolha MEGALOVANIA ou ASGORE para comparar. Começamos com um motor e senoide para facilitar a escuta da melodia.');")
    app+='''
document.querySelectorAll('[data-lab-song]').forEach(button=>button.addEventListener('click',()=>{
  $('video-url').value=`https://www.youtube.com/watch?v=${button.dataset.labSong}`;
  $('link-form').requestSubmit();
}));
window.__listeningLab={engine,get score(){return score;},get job(){return job;}};
'''
    (ui/'app.mjs').write_text(app)
    (folder/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(dict(folder=str(folder),songs=manifest['songs']),indent=2),flush=True)


def serve(folder,port):
    manifest=json.loads((folder/'manifest.json').read_text());songs={s['id']:s for s in manifest['songs']}
    jobs={ident:json.loads((folder/f'{ident}-job.json').read_text()) for ident in songs}
    assets={ '/'+p.name:p for p in (folder/'ui').iterdir() if p.is_file()}
    assets['/']=folder/'ui/index.html'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def file(self,path,kind=None):
            if not path.is_file():self.send_error(404);return
            self.send_response(200);self.send_header('Content-Type',kind or mimetypes.guess_type(path)[0] or 'application/octet-stream')
            self.send_header('Content-Length',str(path.stat().st_size));self.send_header('Cache-Control','no-cache');self.end_headers()
            try:
                with path.open('rb') as source:shutil.copyfileobj(source,self.wfile)
            except (BrokenPipeError,ConnectionResetError):pass
        def json(self,status,value):
            body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        def do_GET(self):
            path=urlsplit(self.path).path
            if path in assets:self.file(assets[path]);return
            if path=='/manifest.json':self.json(200,manifest);return
            for prefix in ['/api/jobs/','/audio/','/guide/']:
                if path.startswith(prefix):
                    ident=path[len(prefix):]
                    if ident not in songs:self.send_error(404);return
                    if prefix=='/api/jobs/':self.json(200,jobs[ident])
                    elif prefix=='/audio/':self.file(Path(songs[ident]['audio']),'audio/wav')
                    else:self.file(folder/f'{ident}-guide.json','application/json')
                    return
            self.send_error(404)
        def do_POST(self):
            if self.path!='/api/jobs':self.send_error(404);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<1 or length>4096:raise ValueError()
                url=urlsplit(json.loads(self.rfile.read(length))['url'])
                ident=url.path.strip('/') if url.hostname=='youtu.be' else parse_qs(url.query).get('v',[''])[0]
            except (ValueError,KeyError,TypeError):ident=''
            if ident not in songs:self.json(400,dict(error='Neste teste, escolha MEGALOVANIA ou ASGORE pelos botões acima.'));return
            self.json(202,dict(id=ident))
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Laboratório A/B: http://127.0.0.1:{port}/',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare-guides','build','serve'])
    p.add_argument('--folder',type=Path,default=FOLDER);p.add_argument('--guide-dir',type=Path)
    p.add_argument('--port',type=int,default=8002);args=p.parse_args()
    folder=args.folder.resolve();folder.mkdir(parents=True,exist_ok=True)
    if args.action=='prepare-guides':prepare_guides(folder)
    elif args.action=='build':build(folder,(args.guide_dir or folder/'guides').resolve())
    else:serve(folder,args.port)


if __name__=='__main__':main()
