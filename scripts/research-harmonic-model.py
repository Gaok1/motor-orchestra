"""Piloto de evidência temporal de parciais: uma versus duas componentes.

Não é reprodução de Klapuri/Benetos nem classificador validado de fontes.
Hipóteses têm envelopes espectrais estáveis durante cada janela analisada.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_run',type=Path)
    parser.add_argument('multipitch_run',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    import numpy as np
    import librosa
    sr,size,hop,partials=44100,4096,256,12
    config=dict(sampleRate=sr,frameSize=size,hopSize=hop,partials=partials,iterations=500,restarts=4,seed=74291)
    result=dict(config=config,script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                warning='Exploratory reconstruction feature; no probability, no calibrated classification, no production integration. Stable partial envelopes can be false for distorted/evolving timbres. Higher-rank model can overfit.',cases=[],songs=[])

    def analyze(path,start,end,midi):
        audio,_=librosa.load(path,sr=sr,mono=True,dtype=np.float64)
        spectrum=np.abs(librosa.stft(audio,n_fft=size,hop_length=hop,window='hann',center=True))
        times=np.arange(spectrum.shape[1])*hop/sr
        selected=(times>=start)&(times<end)
        hz=440*2**((midi-69)/12)
        freqs=np.fft.rfftfreq(size,1/sr)
        rows=[]
        for h in range(1,partials+1):
            # Soma de potência em faixa estreita, depois amplitude; não inferir
            # separação por diferença de <1Hz usando resolução de ~10.8Hz.
            band=np.abs(freqs-h*hz)<=1.5*sr/size
            rows.append(np.sqrt(np.sum(spectrum[band][:,selected]**2,axis=0)))
        y=np.asarray(rows)
        norm=float(np.linalg.norm(y))
        if norm<1e-12: return dict(frames=int(selected.sum()),silent=True)
        y/=norm
        # H0: um vetor de parciais e um envelope de amplitude comum.
        a=y.mean(axis=1)+1e-12
        for _ in range(config['iterations']):
            u=np.maximum(a@y/(a@a+1e-12),0)
            a=np.maximum(y@u/(u@u+1e-12),0)
        fitted=a[:,None]*u[None,:]
        e0=float(np.sum((y-fitted)**2))
        # H1: mesma fonte mais componente com energia apenas em 3,6,9,12.
        # Pode ter outro envelope temporal. Não exige conhecimento do timbre.
        allowed=np.arange(1,partials+1)%3==0
        # H1 inclui H0 quando a segunda componente é zero; manter essa solução
        # evita ganho negativo causado apenas pela otimização aproximada.
        best=(e0,np.column_stack([a,np.zeros_like(a)]),np.vstack([u,np.zeros_like(u)]))
        for seed in range(config['restarts']):
            rng=np.random.default_rng(config['seed']+seed)
            w=np.column_stack([a,np.maximum((y-fitted).mean(axis=1),.001)])
            w[:,1]*=allowed
            h=np.vstack([u,(rng.random(y.shape[1])+.1)*.01])
            for _ in range(config['iterations']):
                h*=np.maximum(w.T@y,1e-16)/np.maximum(w.T@w@h,1e-16)
                w*=np.maximum(y@h.T,1e-16)/np.maximum(w@h@h.T,1e-16)
                w[~allowed,1]=0
                scale=np.maximum(np.linalg.norm(w,axis=0),1e-12)
                w/=scale;h*=scale[:,None]
            error=float(np.sum((y-w@h)**2))
            if error<best[0]: best=(error,w,h)
        e1,w,h=best
        return dict(frames=int(selected.sum()),lowMidi=midi,highMidi=midi+19,
                    normalizedErrorH0=e0,normalizedErrorH1=e1,
                    residualGainFractionOfInputEnergy=max(0,e0-e1),
                    relativeErrorReduction=(e0-e1)/max(e0,1e-12),
                    interpretation='An extra temporal component helps explain these bands; this does not uniquely prove an independent note.',
                    temporalEnvelopes=dict(times=times[selected].tolist(),single=u.tolist(),jointLow=h[0].tolist(),jointHigh=h[1].tolist()),
                    partialEnvelopes=dict(single=a.tolist(),jointLow=w[:,0].tolist(),jointHigh=w[:,1].tolist()))

    controls=json.loads((args.multipitch_run/'controls.json').read_text())
    for case in controls:
        if len(case['name'])<2 or case['name'][1]!='-': continue
        # Mesmo par 55/74 nos casos A–E; F também inclui notas 76 e 77.
        # Não atribuir essas outras alturas à avaliação específica do par.
        row=dict(name=case['name'],ambiguous=case['ambiguous'],start=.12,end=2.6,
                 **analyze(case['path'],.12,2.6,55))
        result['cases'].append(row)
    result['cases'].append(dict(name='D-equivalent-single-source',ambiguous=True,start=.12,end=2.6,
                                **analyze(args.multipitch_run/'audio'/'D-equivalent-single-source.wav',.12,2.6,55)))
    for start,end in [(1.126,1.265),(3.124,3.264),(5.134,5.285),(7.132,7.283)]:
        result['songs'].append(dict(id='0FCvzsVlXpQ',start=start,end=end,
          **analyze(args.source_run/'0FCvzsVlXpQ'/'audio.wav',start,end,55)))
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    for row in result['cases']+result['songs']:
        print(json.dumps({k:v for k,v in row.items() if k not in ['temporalEnvelopes','partialEnvelopes','interpretation']}))


if __name__=='__main__': main()
