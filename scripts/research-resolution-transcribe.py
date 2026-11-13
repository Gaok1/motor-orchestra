"""Síntese alinhada e candidatos reais do Basic Pitch, sem tocar no cache do app."""
import argparse
import hashlib
import json
import logging
from pathlib import Path
import resource
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path);args=p.parse_args()
    run=args.run.resolve()
    import numpy as np
    import soundfile as sf
    from transcribe import _inference_input,_decode_notes
    logging.disable(logging.WARNING)
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model,run_inference
    from basic_pitch.note_creation import model_frames_to_time
    logging.disable(logging.NOTSET)
    protocol=json.loads((run/'protocol.json').read_text());sr=protocol['render']['sampleRate'];duration=protocol['render']['seconds']
    save=lambda path,value:path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
    report=dict(protocol=protocol['render'],rawMapsPreserved=True,measurements=[],scriptSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    model=Model(ICASSP_2022_MODEL_PATH)

    def synth(parts,condition):
        stems={}
        for name,events in parts.items():
            wave=np.zeros(round(duration*sr),dtype=np.float64)
            if condition=='piano-equal':harmonics=[(1,1),(2,.35),(3,.2),(4,.1)];gain=1.;style='pluck'
            elif condition=='soft-reed':
                harmonics=[(1,1),(2,.12),(3,.55),(5,.25)] if name=='MELODY' else [(1,1),(2,.3),(3,.15)]
                gain=.28 if name=='MELODY' else 1.;style='reed' if name=='MELODY' else 'pluck'
            else:
                harmonics=[(1,.18),(2,.45),(3,1),(4,.3),(5,.3),(6,.25)] if name=='MELODY' else [(1,1),(2,.2),(3,.1)]
                gain=.7;style='reed' if name=='MELODY' else 'pluck'
            for a,b,p,velocity in events:
                i,j=round(a*sr),round(b*sr)
                if j<=i:continue
                t=np.arange(j-i)/sr;f=440*2**((p-69)/12)
                signal=sum(v*np.sin(2*np.pi*f*h*t) for h,v in harmonics if f*h<sr/2)
                envelope=np.minimum(1,t/.006)*np.minimum(1,(b-a-t)/.012)
                if style=='pluck':envelope*=np.exp(-2*t)
                wave[i:j]+=signal*envelope*gain*(velocity/127)**.7
            stems[name]=wave
        total=sum(stems.values());scale=.85/max(float(np.max(np.abs(total))),1e-9)
        return total*scale,{k:v*scale for k,v in stems.items()}

    for song in protocol['songs']:
        if not song['synthesize']:continue
        reference=json.loads((run/'reference'/f"{song['id']}-clean.json").read_text())
        start=min(n[0] for part in reference['parts'].values() for n in part)+8
        for condition in protocol['render']['conditions']:
            ident=f"{song['id']}-{condition}";audio_path=run/'audio'/f'{ident}.wav'
            if audio_path.exists():raise RuntimeError(f'Não sobrescrever {ident}')
            parts={k:[] for k in reference['parts']}
            for name,events in reference['parts'].items():
                for a,b,p,velocity in events:
                    if b<=start or a>=start+duration:continue
                    # Nota cortada pela borda é reatacada na síntese em t=0;
                    # a referência correspondente registra exatamente esse ataque.
                    pitch=p-12 if condition=='low-bright' and name=='MELODY' else p
                    parts[name].append([max(0,a-start),min(duration,b-start),pitch,velocity])
            audio,stems=synth(parts,condition)
            sf.write(audio_path,audio,sr,subtype='FLOAT')
            save(run/'reference'/f'{ident}.json',dict(id=ident,duration=duration,originalStart=start,parts=parts))
            row=dict(id=ident,song=song['id'],split=song['split'],condition=condition,
              duration=duration,originalStart=start,audioSHA256=hashlib.sha256(audio_path.read_bytes()).hexdigest())
            started=time.perf_counter()
            with _inference_input(audio_path) as (analysis,scale,tuning):
                row.update(tuningSeconds=time.perf_counter()-started,timeScale=scale,tuningCents=tuning*100)
                started=time.perf_counter();raw=run_inference(analysis,model);row['inferenceSeconds']=time.perf_counter()-started
                times=model_frames_to_time(len(raw['note']))*scale
                np.savez_compressed(run/'raw'/f'{ident}.npz',**raw,times=times)
                started=time.perf_counter();decoded=_decode_notes(raw,.25,.15);row['decodeSeconds']=time.perf_counter()-started
                notes=sorted([[round(float(times[a]),3),round(float(times[b]),3),int(p),round(float(v),3)] for a,b,p,v in decoded],key=lambda n:(n[0],n[2]))
                features=[]
                for a,b,p,amp in notes:
                    i,j=np.searchsorted(times,[a,b]);j=max(i+1,j)
                    pitch=p-21;center=3*pitch
                    lo,hi=np.searchsorted(times,[a-.05,a+.05]);hi=max(lo+1,hi)
                    local=raw['contour'][i:j,max(0,center-2):center+3]
                    if local.size:
                        masses=local.sum(axis=1)+1e-9
                        centers=(local*np.arange(local.shape[1])).sum(axis=1)/masses
                        stability=float(np.std(centers)/3)
                    else:stability=0.
                    features.append(dict(noteMean=float(raw['note'][i:j,pitch].mean()),
                      onsetPeak=float(raw['onset'][lo:hi,pitch].max()),pitchStd=stability,hasAcoustic=True))
                save(run/'candidates'/f'{ident}.json',dict(id=ident,duration=duration,notes=notes,features=features))
            row.update(candidates=len(notes),melodyEvents=len(parts['MELODY']),processPeakRSSMiBCumulative=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
            report['measurements'].append(row);save(run/'transcription.json',report)
            print(json.dumps(row),flush=True)


if __name__=='__main__':main()
