"""Corrige relógio de um primeiro experimento que não reinseria quadros vazios.

Reaproveita as alturas estimadas. Recusa saída que já tenha sido alinhada.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_run',type=Path)
    parser.add_argument('run',type=Path)
    parser.add_argument('--essentia-path',type=Path,required=True)
    args=parser.parse_args()
    sys.path.insert(0,str(args.essentia_path.resolve()))
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    import numpy as np
    import librosa
    import essentia.standard as es
    from transcribe import _inference_input
    from research_pitch_sets import klapuri_frame_mask,pitch_set_metrics
    save=lambda p,obj: p.write_text(json.dumps(obj,indent=2,ensure_ascii=False,allow_nan=False)+'\n')
    result_path=args.run/'results.json'
    result=json.loads(result_path.read_text())
    if result.get('klapuri_clock_aligned'): raise RuntimeError('Run já alinhado')
    settings=result['settings']
    # Preservar o primeiro resultado para auditoria, explicitamente inválido no tempo.
    (args.run/'obsolete-unaligned-results.json').write_bytes(result_path.read_bytes())

    def align(name,audio,scale):
        path=args.run/f'{name}-MultiPitchKlapuri.json'
        data=json.loads(path.read_text())
        filtered=es.EqualLoudness(sampleRate=settings['sampleRate'])(np.ascontiguousarray(audio,dtype=np.float32))
        started=time.perf_counter()
        mask=klapuri_frame_mask(filtered,settings)
        seconds=time.perf_counter()-started
        assert int(mask.sum())==len(data['pitch']), (name,int(mask.sum()),len(data['pitch']))
        raw=iter(data['pitch'])
        frames=[next(raw) if keep else [] for keep in mask]
        times=np.arange(len(frames))*settings['hopSize']/settings['sampleRate']*scale
        data.update(times=times.tolist(),pitch=frames,raw_retained_frame_indices=np.flatnonzero(mask).tolist(),
                    omitted_frames=int((~mask).sum()),alignment_seconds=seconds,
                    alignment='Reinserted empty frames using reconstructed Essentia salience-peak presence; retained count asserted equal to native output.')
        save(path,data)
        print(name,len(frames),len(data['raw_retained_frame_indices']),seconds,flush=True)
        return frames,times,data

    controls=json.loads((args.run/'controls.json').read_text())
    for case,row in zip(controls,result['cases']):
        assert case['name']==row['name']
        audio,_=librosa.load(case['path'],sr=settings['sampleRate'],mono=True,dtype=np.float32)
        frames,times,data=align(case['name'],audio,1)
        row['algorithms']['MultiPitchKlapuri'].update(pitch_set_metrics(frames,times,case['reference'],case['lead']),
                                                     omittedFrames=data['omitted_frames'],alignmentSeconds=data['alignment_seconds'])
    for row in result['songs']:
        with _inference_input(args.source_run/row['id']/'audio.wav') as (analysis,scale,tuning):
            assert abs(scale-row['time_scale'])<1e-12
            audio,_=librosa.load(analysis,sr=settings['sampleRate'],mono=True,dtype=np.float32)
            frames,times,data=align(row['id'],audio,scale)
            algorithm=row['algorithms']['MultiPitchKlapuri']
            algorithm.update(frames=len(frames),rawRetainedFrames=len(data['raw_retained_frame_indices']),
                             omittedFrames=data['omitted_frames'],alignmentSeconds=data['alignment_seconds'],
                             meanPolyphony=float(np.mean([len(f) for f in frames])))
            for window in algorithm['conflicts']:
                selected=[frame for frame,t in zip(frames,times) if window['start']<=t<window['end']]
                window.update(frames=len(selected),pitchFrameCounts={str(p):sum(any(abs(69+12*np.log2(x/440)-p)<.5 for x in frame) for frame in selected) for p in [55,74]})
    result.update(klapuri_clock_aligned=True,alignment_script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  clock_helper_sha256=hashlib.sha256(Path(__file__).with_name('research_pitch_sets.py').read_bytes()).hexdigest())
    save(result_path,result)


if __name__=='__main__': main()
