"""Porta somente APIs Keras antigas, carregando todos os tensores publicados.

Não é reimplementação aproximada da arquitetura: executa get_model do autor,
com imports atuais, nomes originais de BatchNorm e tf.squeeze em Lambda.
Resultados são inferência local de um port, não reprodução do benchmark de 2018.
"""
import argparse
import ast
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import sys
import time
from types import SimpleNamespace
os.environ.setdefault('TF_NUM_INTRAOP_THREADS','4')
os.environ.setdefault('TF_NUM_INTEROP_THREADS','1')
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('run',type=Path)
    p.add_argument('--repo',type=Path,required=True)
    p.add_argument('--only',nargs='+');p.add_argument('--output',type=Path)
    p.add_argument('--validate-chunk',action='store_true');p.add_argument('--resume',action='store_true')
    p.add_argument('--pop-split',choices=['train','development','test']);args=p.parse_args()
    import h5py
    import numpy as np
    import tensorflow as tf
    import keras
    import librosa
    run=args.run.resolve();output=args.output or run/'multitask';output.mkdir(exist_ok=True)
    weights=args.repo/'experiment_output/multitask_base_experiment/model_weights.h5'
    model_source=args.repo/'deepsalience/mutlitask_experiments/multitask_base_experiment.py'
    node=next(n for n in ast.parse(model_source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='get_model')
    bn_count=0
    def batch_normalization(*a,**kw):
        nonlocal bn_count
        bn_count+=1
        return keras.layers.BatchNormalization(*a,name=f'batch_normalization_{bn_count}',**kw)
    names=['Input','Conv2D','Lambda','Multiply','Concatenate']
    scope={n:getattr(keras.layers,n) for n in names}
    scope.update(Model=keras.Model,K=SimpleNamespace(squeeze=tf.squeeze),BatchNormalization=batch_normalization)
    exec(compile(ast.Module(body=[node],type_ignores=[]),str(model_source),'exec'),scope)
    with contextlib.redirect_stdout(io.StringIO()):model=scope['get_model']()
    assigned=0;layer_checks=[]
    with h5py.File(weights,'r') as f:
        config=json.loads(f.attrs['model_config']);original={l['config']['name']:l for l in config['config']['layers']}
        for layer in model.layers:
            if not layer.weights:continue
            group=f['model_weights'][layer.name]
            names=[n.decode() if isinstance(n,bytes) else n for n in group.attrs['weight_names']]
            arrays=[np.asarray(group[n]) for n in names]
            layer.set_weights(arrays)
            assert all(np.array_equal(a,b) for a,b in zip(arrays,layer.get_weights()))
            for key in ['filters','kernel_size','strides','padding','activation','axis','momentum','epsilon']:
                if key in original[layer.name]['config']:
                    a=original[layer.name]['config'][key];b=layer.get_config()[key]
                    if isinstance(a,list):a=tuple(a)
                    if isinstance(b,list):b=tuple(b)
                    assert a==b,(layer.name,key,a,b)
            assigned+=len(arrays);layer_checks.append(dict(name=layer.name,tensors=len(arrays)))
    assert assigned==len(model.weights),(assigned,len(model.weights))
    thresholds=json.loads((args.repo/'experiment_output/multitask_base_experiment/evaluation/thresholds.json').read_text())
    report=dict(tensorflow=tf.__version__,keras=keras.__version__,librosa=librosa.__version__,
      weightsSHA256=hashlib.sha256(weights.read_bytes()).hexdigest(),sourceSHA256=hashlib.sha256(model_source.read_bytes()).hexdigest(),
      assignedTensors=assigned,layerChecks=layer_checks,thresholds=thresholds,
      adaptation='Author get_model executed with current Keras layer imports, explicit original BN names and tf.squeeze. All published weight arrays loaded and checked exactly; layer parameters checked. Modern HCQT library, not bitwise original front-end.',cases=[])
    source=Path('downloads/research/multipitch-20261112')
    controls=json.loads((source/'controls.json').read_text())
    jobs=[dict(id=c['name'],path=Path(c['path']),duration=2.8 if c['name'][1:2]=='-' else 2.7,lead=c['lead'],ambiguous=c['ambiguous']) for c in controls]
    # Esses dois prefixos não têm gabarito musical; só evidência e suporte.
    old=Path('downloads/research/20261112T164100.748825Z')
    for ident in ['0FCvzsVlXpQ','PJ1yqbr8Y50']:
        jobs.append(dict(id=ident,path=old/ident/'audio.wav',duration=16,lead=None,ambiguous=False))
    if args.pop_split:
        jobs=[]
        protocol=json.loads((run/'protocol.json').read_text())
        for song in protocol['songs']:
            if song['split']!=args.pop_split or not song['synthesize']:continue
            for condition in protocol['render']['conditions']:
                ident=f"{song['id']}-{condition}"
                reference=json.loads((run/'reference'/f'{ident}.json').read_text())
                jobs.append(dict(id=ident,path=run/'audio'/f'{ident}.wav',duration=reference['duration'],
                  lead=reference['parts']['MELODY'],ambiguous=False))
    if args.resume and (output/'results.json').exists():
        report['cases']=json.loads((output/'results.json').read_text())['cases']
    done={row['id'] for row in report['cases']}
    for job in jobs:
        ident=job['id'];dest=output/f'{ident}.npz'
        if args.only and ident not in args.only:continue
        if ident in done:continue
        reused=args.resume and dest.exists()
        if reused:
            saved=np.load(dest);times=saved['times'];outputs=[saved[k] for k in ['multif0','melody','bass','vocal']]
            length=len(times);preprocessing=elapsed=None
        else:
            started=time.perf_counter()
            audio,_=librosa.load(job['path'],sr=22050,mono=True,duration=job['duration'])
            cqt=[]
            for harmonic in [1,2,3,4,5]:
                cqt.append(librosa.cqt(y=audio,sr=22050,hop_length=256,fmin=32.7*harmonic,n_bins=360,bins_per_octave=60))
            length=min(x.shape[1] for x in cqt)
            hcqt=librosa.amplitude_to_db(np.abs(np.asarray([x[:,:length] for x in cqt])),ref=np.max)/80+1
            hcqt=hcqt.transpose(1,2,0).astype(np.float32)
            preprocessing=time.perf_counter()-started
            started=time.perf_counter();outputs=[[] for _ in range(4)]
            for a in range(0,length,96):
                b=min(length,a+96);lo=max(0,a-20);hi=min(length,b+20)
                predictions=model(hcqt[np.newaxis,:,lo:hi,:],training=False)
                for out,prediction in zip(outputs,predictions):out.append(np.asarray(prediction)[0,:,a-lo:b-lo])
            outputs=[np.concatenate(x,axis=1) for x in outputs]
            elapsed=time.perf_counter()-started;times=np.arange(length)*256/22050
            np.savez_compressed(dest,times=times,**dict(zip(['multif0','melody','bass','vocal'],outputs)))
        row=dict(id=ident,preprocessingSeconds=preprocessing,inferenceSeconds=elapsed,frames=length,
          processPeakRSSMiBCumulative=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
        row['reusedSavedOutputs']=reused
        if args.validate_chunk:
            full=model(hcqt[np.newaxis],training=False)
            error=max(float(np.max(np.abs(a-np.asarray(b)[0]))) for a,b in zip(outputs,full))
            assert error<1e-5,error
            row['chunkVsFullMaxAbsoluteError']=error
        if job['lead'] is not None:
            selected=outputs[1].argmax(axis=0);confidence=outputs[1].max(axis=0)
            midi=69+12*np.log2(32.7*2**(selected/60)/440)
            hits=total=0
            for a,b,pitch,*_ in job['lead']:
                active=(times>=a)&(times<b);total+=int(active.sum())
                hits+=int(np.sum(active&(confidence>=thresholds['melody'])&(np.abs(midi-pitch)<.5)))
            row.update(designatedLeadRecall=hits/max(total,1),ambiguous=job['ambiguous'])
        if ident=='0FCvzsVlXpQ':
            row['conflicts']=[]
            for a,b in [(1.126,1.265),(3.124,3.264),(5.134,5.285),(7.132,7.283)]:
                active=(times>=a)&(times<b)
                support={}
                for pitch in [55,74]:
                    index=round(60*np.log2((440*2**((pitch-69)/12))/32.7))
                    support[str(pitch)]={name:float(out[max(0,index-1):index+2,active].mean()) for name,out in zip(['multif0','melody','bass','vocal'],outputs)}
                row['conflicts'].append(dict(start=a,end=b,support=support))
        report['cases'].append(row)
        (output/'results.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        print(json.dumps(row),flush=True)


if __name__=='__main__':main()
