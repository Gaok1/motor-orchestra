"""Métricas temporais exatas e oráculos estritos sobre eventos disponíveis."""
from bisect import bisect_right
from collections import defaultdict
import time


def merged(intervals):
    out=[]
    for a,b in sorted(intervals):
        if b<=a:continue
        if out and a<=out[-1][1]+1e-10:out[-1][1]=max(out[-1][1],b)
        else:out.append([a,b])
    return out


def intersect(a,b):
    i=j=0;out=[]
    while i<len(a) and j<len(b):
        x,y=max(a[i][0],b[j][0]),min(a[i][1],b[j][1])
        if y>x:out.append([x,y])
        if a[i][1]<b[j][1]:i+=1
        else:j+=1
    return out


def length(xs):return sum(b-a for a,b in xs)


def by_pitch(events,duration):
    groups=defaultdict(list)
    for a,b,p,*_ in events:
        a,b=max(0,a),min(duration,b)
        if b>a:groups[int(p)].append([a,b])
    return {p:merged(xs) for p,xs in groups.items()}


def temporal(pred,ref,duration,candidates=None):
    r=by_pitch(ref,duration);e=by_pitch(pred,duration)
    rs=sum(length(x) for x in r.values());es=sum(length(x) for x in e.values())
    correct=sum(length(intersect(xs,e.get(p,[]))) for p,xs in r.items())
    voiced_ref=merged([x for xs in r.values() for x in xs]);voiced_est=merged([x for xs in e.values() for x in xs])
    silence=duration-length(voiced_ref)
    silent_play=length(voiced_est)-length(intersect(voiced_est,voiced_ref))
    out=dict(referenceNoteSeconds=rs,predictedNoteSeconds=es,correctNoteSeconds=correct,
      melodyCoverage=correct/rs if rs else None,temporalPrecision=correct/es if es else 0,
      temporalRecall=correct/rs if rs else None,
      temporalF1=2*correct/(rs+es) if rs+es else None,
      referenceSilenceSeconds=silence,playedDuringSilenceSeconds=max(0,silent_play),
      playedDuringSilenceFraction=max(0,silent_play)/silence if silence>1e-10 else None)
    if candidates is not None:
        c=by_pitch(candidates,duration)
        available={p:intersect(xs,c.get(p,[])) for p,xs in r.items()}
        available_s=sum(length(xs) for xs in available.values())
        chosen_available=sum(length(intersect(xs,e.get(p,[]))) for p,xs in available.items())
        out.update(availableCorrectNoteSeconds=available_s,
          temporalOracleCoverage=available_s/rs if rs else None,
          absentNoteSeconds=max(0,rs-available_s),availableButUnselectedNoteSeconds=max(0,available_s-chosen_available),
          selectedCorrectAvailableSeconds=chosen_available,correctOutsideCandidateSupportSeconds=max(0,correct-chosen_available))
    return out


def evaluate(pred,ref,duration,candidates=None):
    import numpy as np
    import mir_eval
    out=temporal(pred,ref,duration,candidates)
    if ref and pred:
        ri=np.asarray([n[:2] for n in ref],dtype=float);ei=np.asarray([n[:2] for n in pred],dtype=float)
        rp=440*2**((np.asarray([n[2] for n in ref])-69)/12)
        ep=440*2**((np.asarray([n[2] for n in pred])-69)/12)
        p,r,f,_=mir_eval.transcription.precision_recall_f1_overlap(ri,rp,ei,ep,onset_tolerance=.05,offset_ratio=.2,offset_min_tolerance=.05)
        ap,ar,af,_=mir_eval.transcription.precision_recall_f1_overlap(ri,rp,ei,ep,onset_tolerance=.05,offset_ratio=None)
        matches=mir_eval.transcription.match_notes(ri,rp,ei,ep,onset_tolerance=.05,offset_ratio=None)
        sustain=sum(max(0,float(ei[j,1]-ri[i,1])) for i,j in matches)
        pure=mir_eval.onset.f_measure(np.sort(ri[:,0]),np.sort(ei[:,0]),window=.05)
    else:
        p=r=f=ap=ar=af=0.;sustain=0.;pure=(0.,0.,0.)
    out.update(notePrecision=p,noteRecall=r,noteF1=f if ref else None,
      onsetPitchPrecision=ap,onsetPitchRecall=ar,onsetPitchF1=af if ref else None,
      onsetOnlyF1=pure[0] if ref else None,falseSustainSeconds=sustain,
      referenceEvents=len(ref),predictedEvents=len(pred))
    return out


def oracle_coverage(candidates,reference):
    """Ótimo exato de cobertura correta com eventos inteiros, sem novos ataques.

    Weighted interval scheduling. Desempate por menor duração incorreta; não é
    um limite superior para um arranjador autorizado a cortar eventos.
    """
    by=defaultdict(list)
    for a,b,p,*_ in reference:by[p].append([a,b])
    by={p:merged(xs) for p,xs in by.items()}
    notes=sorted(candidates,key=lambda n:(n[1],n[0],n[2]))
    ends=[n[1] for n in notes];dp=[(0.,0.)];back=[]
    for i,n in enumerate(notes):
        a,b,p,*_=n
        correct=length(intersect([[a,b]],by.get(p,[])))
        j=bisect_right(ends,a+1e-10,hi=i)
        option=(dp[j][0]+correct,dp[j][1]-(b-a-correct))
        if correct>0 and option>dp[-1]:dp.append(option);back.append(j)
        else:dp.append(dp[-1]);back.append(None)
    selected=[];i=len(notes)
    while i:
        j=back[i-1]
        if j is None:i-=1
        else:selected.append(notes[i-1]);i=j
    return sorted(selected,key=lambda n:(n[0],n[2]))


def oracle_event_f1(candidates,reference,time_limit=30):
    """MILP: máximo de correspondências de eventos sob monofonia estrita.

    Uma variável para cada par elegível candidato/referência. Restrições de
    correspondência um-a-um e cliques de sobreposição. Selecionar só matches dá
    precisão 1 e maximizar TP maximiza F1 para esse contrato de eventos inteiros.
    """
    import numpy as np
    from scipy.optimize import Bounds,LinearConstraint,milp
    from scipy.sparse import coo_matrix
    started=time.perf_counter();pairs=[];by_c=defaultdict(list);by_r=defaultdict(list)
    for i,(a,b,p,*_) in enumerate(candidates):
        for j,(ra,rb,rp,*_) in enumerate(reference):
            # Mesmo arredondamento de distâncias temporais do mir_eval 0.8.2.
            if p==rp and np.around(abs(a-ra),4)<=.05 and np.around(abs(b-rb),4)<=max(.05,.2*(rb-ra)):
                k=len(pairs);pairs.append((i,j));by_c[i].append(k);by_r[j].append(k)
    if not pairs:return [],dict(seconds=time.perf_counter()-started,optimal=True,pairs=0,matched=0)
    constraints=list(by_c.values())+list(by_r.values())
    edges=[]
    for i in by_c:
        a,b,*_=candidates[i];edges.extend([(a,1,i),(b,0,i)])
    active=set()
    for _,kind,i in sorted(edges):
        if kind:
            active.add(i)
            if len(active)>1:constraints.append([k for n in active for k in by_c[n]])
        else:active.discard(i)
    row=[];col=[]
    for r,ks in enumerate(constraints):
        row.extend([r]*len(ks));col.extend(ks)
    matrix=coo_matrix((np.ones(len(row)),(row,col)),shape=(len(constraints),len(pairs))).tocsc()
    answer=milp(-np.ones(len(pairs)),integrality=np.ones(len(pairs)),bounds=Bounds(0,1),
      constraints=LinearConstraint(matrix,-np.inf,np.ones(len(constraints))),
      options={'time_limit':time_limit,'mip_rel_gap':0})
    if answer.x is None:raise RuntimeError(f'Oracle MILP failed: {answer.message}')
    indices=[pairs[k][0] for k,x in enumerate(answer.x) if x>.5]
    selected=sorted([candidates[i] for i in indices],key=lambda n:(n[0],n[2]))
    assert all(a[1]<=b[0]+1e-9 for a,b in zip(selected,selected[1:]))
    return selected,dict(seconds=time.perf_counter()-started,optimal=answer.status==0,status=int(answer.status),pairs=len(pairs),matched=len(selected),mipGap=float(getattr(answer,'mip_gap',0)))
