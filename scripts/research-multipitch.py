"""Comparação isolada de hipóteses de altura e controles adversários conhecidos.

Não incorpora Essentia ao aplicativo. Mantém relógio/afinação do experimento original.
"""
import argparse
import hashlib
import json
import logging
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_run', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--essentia-path', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.essentia_path.resolve()))
    import numpy as np
    import soundfile as sf
    import librosa
    import essentia
    import essentia.standard as es
    from transcribe import _inference_input, _decode_notes
    from research_pitch_sets import klapuri_frame_mask, pitch_set_metrics as metrics
    logging.disable(logging.WARNING)
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, run_inference
    from basic_pitch.note_creation import model_frames_to_time
    logging.disable(logging.NOTSET)

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    (output / 'audio').mkdir()
    sr, hop = 44100, 128
    settings = dict(sampleRate=sr, frameSize=2048, hopSize=hop, minFrequency=80, maxFrequency=2000)
    save = lambda p, obj: Path(p).write_text(json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False)+'\n')
    manifest = {'essentia': essentia.__version__, 'settings': settings, 'other_parameters': 'library defaults',
                'preprocessing': 'EqualLoudness for both estimators; original prior research configuration',
                'metrics': '50-cent one-to-one pitch-set matching per frame, not note-event F1. Designated-lead recall separate from all-source precision/recall.',
                'warning': 'Deterministic pilot controls, no real-song aligned ground truth; D is observationally ambiguous.',
                'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'klapuri_clock_aligned': True,
                'clock_helper_sha256': hashlib.sha256(Path(__file__).with_name('research_pitch_sets.py').read_bytes()).hexdigest(),
                'cases': [], 'songs': []}
    save(output / 'results.json', manifest)

    def tone(start, end, midi, partials, gain=1, vibrato=0, rate=5, hz=None):
        return dict(start=start, end=end, midi=midi, partials=partials, gain=gain, vibrato=vibrato, rate=rate, hz=hz)

    def synth(sources, duration):
        wave = np.zeros(round(duration*sr), dtype=np.float64)
        for event in sources:
            a, b = round(event['start']*sr), round(event['end']*sr)
            t = np.arange(b-a)/sr
            f = event['hz'] or 440*2**((event['midi']-69)/12)
            frequencies = f*2**(event['vibrato']*np.sin(2*np.pi*event['rate']*t)/1200)
            phase = 2*np.pi*np.cumsum(frequencies)/sr
            envelope = np.minimum(1,t/.005)*np.minimum(1,(event['end']-event['start']-t)/.015)
            wave[a:b] += event['gain']*envelope*sum(g*np.sin(h*phase) for h,g in event['partials'])
        return wave

    controls = []
    old = json.loads((args.source_run/'synthetic-controls'/'results.json').read_text())
    for case in old['cases']:
        ref = case['reference']
        controls.append(dict(name=case['name'], path=args.source_run/'synthetic-controls'/f"{case['name']}.wav",
                             reference=ref['lead']+ref['bass'], lead=ref['lead'], ambiguous=False))
    f = 440*2**((55-69)/12)
    rich = [(1,.65),(2,.35),(3,.25),(4,.2),(5,.15),(6,.1)]
    cases = [
        ('A-strong-third', [tone(.2,2.5,55,[(1,.2),(2,.4),(3,1),(4,.2),(5,.15),(6,.3)])], [[.2,2.5,55]], [[.2,2.5,55]], False),
        ('B-real-pair-modulated', [tone(.2,2.5,55,rich,vibrato=5,rate=4.2), tone(.2,2.5,74,rich,gain=.45,vibrato=35,rate=5.5)],
         [[.2,2.5,55],[.2,2.5,74]], [[.2,2.5,74]], False),
        ('C-real-pair-staggered', [tone(.2,1.7,55,rich),tone(.9,2.5,74,rich,gain=.45)],
         [[.2,1.7,55],[.9,2.5,74]], [[.9,2.5,74]], False),
        ('D-identical-observation', [tone(.2,2.5,55,[(1,.8),(2,.3),(3,.25),(4,.1)]),tone(.2,2.5,74,[(1,.35),(2,.1)],hz=3*f)],
         [[.2,2.5,55],[.2,2.5,74]], [[.2,2.5,74]], True),
        ('E-missing-fundamental', [tone(.2,2.5,55,[(2,.6),(3,1),(4,.3),(5,.2),(6,.25)])],
         [[.2,2.5,55]], [[.2,2.5,55]], False),
        ('F-soft-high-lead', [tone(.2,2.5,55,rich)]+[tone(.2+i*.46,.61+i*.46,p,rich,gain=.18) for i,p in enumerate([74,76,77,76,74])],
         [[.2,2.5,55]]+[[.2+i*.46,.61+i*.46,p] for i,p in enumerate([74,76,77,76,74])],
         [[.2+i*.46,.61+i*.46,p] for i,p in enumerate([74,76,77,76,74])], False),
    ]
    for name,sources,reference,lead,ambiguous in cases:
        wave=synth(sources,2.8)
        if ambiguous:
            single=synth([tone(.2,2.5,55,[(1,.8),(2,.3),(3,.6),(4,.1),(6,.1)])],2.8)
            error=float(np.max(np.abs(wave-single)))
            assert error < 1e-8, error
            manifest['ambiguity_max_absolute_sample_error']=error
            sf.write(output/'audio'/'D-equivalent-single-source.wav',single*.8/max(np.max(np.abs(wave)),1e-9),sr,subtype='FLOAT')
        path=output/'audio'/f'{name}.wav'
        sf.write(path,wave*.8/max(np.max(np.abs(wave)),1e-9),sr,subtype='FLOAT')
        controls.append(dict(name=name,path=path,reference=reference,lead=lead,ambiguous=ambiguous,sources=sources))
    save(output/'controls.json',[{**c,'path':str(c['path'])} for c in controls])

    def estimate(audio,name,scale=1):
        filtered=es.EqualLoudness(sampleRate=sr)(np.ascontiguousarray(audio,dtype=np.float32))
        outputs={}
        for algorithm in ['MultiPitchMelodia','MultiPitchKlapuri']:
            print(f'START {name} {algorithm}',flush=True)
            started=time.perf_counter()
            pitches=getattr(es,algorithm)(**settings)(filtered)
            elapsed=time.perf_counter()-started
            frames=[[float(x) for x in frame if x>0] for frame in pitches]
            if algorithm == 'MultiPitchKlapuri':
                mask=klapuri_frame_mask(filtered,settings)
                assert int(mask.sum())==len(frames), (name,int(mask.sum()),len(frames))
                retained=iter(frames)
                frames=[next(retained) if keep else [] for keep in mask]
            times=np.arange(len(frames))*hop/sr*scale
            save(output/f'{name}-{algorithm}.json',dict(times=times.tolist(),pitch=frames,time_scale=scale))
            outputs[algorithm]=(frames,times,elapsed)
            print(f'DONE {name} {algorithm} {elapsed:.3f}s {len(frames)} frames',flush=True)
        return outputs

    model=Model(ICASSP_2022_MODEL_PATH)
    for case in controls:
        audio,_=librosa.load(case['path'],sr=sr,mono=True,dtype=np.float32)
        row={k:v for k,v in case.items() if k!='path'}
        row['audio_sha256']=hashlib.sha256(case['path'].read_bytes()).hexdigest()
        row['algorithms']={}
        for algorithm,(frames,times,elapsed) in estimate(audio,case['name']).items():
            row['algorithms'][algorithm]={'seconds':elapsed,**metrics(frames,times,case['reference'],case['lead'])}
        started=time.perf_counter()
        raw=run_inference(case['path'],model)
        events=_decode_notes(raw,.25,.15)
        bp_times=model_frames_to_time(len(raw['note']))
        events=[[float(bp_times[a]),float(bp_times[b]),int(p),float(v)] for a,b,p,v in events]
        times=np.arange(int(np.ceil(len(audio)/hop)))*hop/sr
        frames=[[440*2**((p-69)/12) for a,b,p,v in events if a<=t<b] for t in times]
        row['algorithms']['BasicPitch']={'seconds':time.perf_counter()-started,**metrics(frames,times,case['reference'],case['lead'])}
        np.savez_compressed(output/f"{case['name']}-basic-pitch.npz",**raw,times=bp_times)
        save(output/f"{case['name']}-basic-pitch-events.json",events)
        manifest['cases'].append(row)
        save(output/'results.json',manifest)
        print(json.dumps(row),flush=True)
    for song in json.loads((args.source_run/'manifest.json').read_text())['songs']:
        path=args.source_run/song['id']/'audio.wav'
        with _inference_input(path) as (analysis_path,scale,tuning):
            audio,_=librosa.load(analysis_path,sr=sr,mono=True,dtype=np.float32)
            row=dict(id=song['id'],duration=song['duration'],time_scale=scale,tuning_cents=tuning*100,
                     audio_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),algorithms={})
            for algorithm,(frames,times,elapsed) in estimate(audio,song['id'],scale).items():
                windows=[]
                if song['id']=='0FCvzsVlXpQ':
                    for a,b in [(1.126,1.265),(3.124,3.264),(5.134,5.285),(7.132,7.283)]:
                        selected=[frame for frame,t in zip(frames,times) if a<=t<b]
                        counts={str(p):sum(any(abs(69+12*np.log2(x/440)-p)<.5 for x in frame) for frame in selected) for p in [55,74]}
                        windows.append(dict(start=a,end=b,frames=len(selected),pitchFrameCounts=counts))
                row['algorithms'][algorithm]=dict(seconds=elapsed,frames=len(frames),
                    meanPolyphony=float(np.mean([len(f) for f in frames])),conflicts=windows)
            manifest['songs'].append(row)
            save(output/'results.json',manifest)
            print(json.dumps(row),flush=True)


if __name__=='__main__':
    main()
