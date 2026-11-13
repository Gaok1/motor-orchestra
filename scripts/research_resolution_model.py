"""Protótipo próprio, sem identificação de pistas e sem exclusão harmônica."""
from collections import Counter
import math
import numpy as np

FEATURES=['midi','duration','strength','noteMean','onsetPeak','pitchStd','hasAcoustic',
 'localRank','relativePitch','activeCount','attackCount','distanceAbove','distanceBelow',
 'relativeStrength','harmonicParent','previousNear','followingNear','durationRatio',
 'repetitionCount','phraseRank','globalRank','gapBefore','gapAfter']


def prepared_job(job):
    """Mesma política de eventos mínimos e uníssonos do baseline congelado."""
    groups={}
    for i,n in enumerate(job['notes']):
        a,b,p,s,*_=n
        if a<0 or b-a<.03 or p<0 or p>127 or s<.15:continue
        key=(p,a)
        if key not in groups or (s,b)>(groups[key][1][3],groups[key][1][1]):groups[key]=(i,n[:4])
    pitches={}
    for i,n in groups.values():pitches.setdefault(n[2],[]).append((i,n))
    selected=[]
    for group in pitches.values():
        group.sort(key=lambda x:x[1][0])
        for k,(i,n) in enumerate(group):
            n=list(n)
            if k+1<len(group):n[1]=min(n[1],group[k+1][1][0])
            if n[1]-n[0]>=.03:selected.append((i,n))
    selected.sort(key=lambda x:(x[1][0],-x[1][3],x[1][2]))
    return {**job,'notes':[n for _,n in selected],
      'features':[job.get('features',[{}]*len(job['notes']))[i] for i,_ in selected]}


def features(job):
    notes=np.asarray([n[:4] for n in job['notes']],dtype=float)
    if len(notes)==0:return np.empty((0,len(FEATURES)))
    starts,ends,pitches,amps=notes.T;durs=ends-starts
    counts=Counter((int(p),round(math.log2(max(d,.03))*2)) for p,d in zip(pitches,durs))
    rows=[]
    for i,(a,b,p,s) in enumerate(notes):
        local=(starts<=a+.5)&(ends>=a-.5)
        active=(starts<=a+.025)&(ends>a+.025)
        attack=np.abs(starts-a)<=.045
        lp=pitches[local];ls=amps[local]
        rank=(np.sum(lp<p)+.5*np.sum(lp==p))/max(1,len(lp))
        above=pitches[active&(pitches>p)]-p;below=p-pitches[active&(pitches<p)]
        lower=(pitches<p)&(np.abs(starts-a)<.08)&(ends>a)
        parent=0.
        for j in np.flatnonzero(lower):
            interval=int(p-pitches[j])
            if interval in [12,19,24,28,31,36]:
                overlap=max(0,min(b,ends[j])-max(a,starts[j]))/max(b-a,.001)
                parent=max(parent,overlap*min(1,max(0,amps[j]-s)/max(s,.01)))
        before=(starts<a-.001)&(np.abs(ends-a)<.3)&(np.abs(pitches-p)<8)
        after=(starts>a+.001)&(np.abs(starts-b)<.3)&(np.abs(pitches-p)<8)
        prev=float(np.max(1-np.abs(pitches[before]-p)/8)) if before.any() else 0.
        nxt=float(np.max(1-np.abs(pitches[after]-p)/8)) if after.any() else 0.
        phrase=(starts<=a+3)&(ends>=a-3)
        acoustic=job.get('features',[{}]*len(notes))[i]
        gap_before=float(np.min(np.abs(ends[before]-a))) if before.any() else 1.
        gap_after=float(np.min(np.abs(starts[after]-b))) if after.any() else 1.
        rows.append([p,min(8,b-a),s,acoustic.get('noteMean',s),acoustic.get('onsetPeak',s),acoustic.get('pitchStd',0),
          int(acoustic.get('hasAcoustic',False)),rank,(p-float(np.median(lp)))/12,int(active.sum()),int(attack.sum()),
          min(24,float(above.min())) if len(above) else 24,min(24,float(below.min())) if len(below) else 24,
          s/max(float(ls.max()),.01),parent,prev,nxt,(b-a)/max(float(np.median(durs[local])),.03),
          math.log1p(counts[int(p),round(math.log2(max(b-a,.03))*2)]),
          float(np.mean(pitches[phrase]<=p)),float(np.mean(pitches<=p)),gap_before,gap_after])
    return np.asarray(rows,dtype=np.float32)


def labels(notes,reference):
    """Existência por sobreposição na mesma altura; melodia por papel anotado.

    Fragmentos podem ser positivos. Esses rótulos de tempo não são matches F1.
    """
    from research_resolution_metrics import by_pitch,intersect,length
    maximum=max([n[1] for part in reference['parts'].values() for n in part]+[reference['duration']])
    parts={k:by_pitch(v,maximum) for k,v in reference['parts'].items()}
    all_notes=[n for part in reference['parts'].values() for n in part]
    union=by_pitch(all_notes,maximum)
    exist=[];mel=[];anchor=[]
    melody=reference['parts']['MELODY']
    for a,b,p,*_ in notes:
        ratio=lambda group:length(intersect([[a,b]],group.get(p,[])))/max(b-a,.001)
        exist.append(int(ratio(union)>=.5));mel.append(int(ratio(parts['MELODY'])>=.5))
        options=[(max(0,min(b,rb)-max(a,ra)),j) for j,(ra,rb,rp,*_) in enumerate(melody) if rp==p]
        value,j=max(options,default=(0,-1))
        anchor.append(j if value/max(b-a,.001)>=.5 else -1)
    return np.asarray(exist),np.asarray(mel),np.asarray(anchor)


def edges(notes):
    starts=np.asarray([n[0] for n in notes]);ends=np.asarray([n[1] for n in notes]);pairs=[]
    for i,(a,b,p,s,*_) in enumerate(notes):
        eligible=np.flatnonzero((np.arange(len(notes))<i)&((starts>=a-2)|(ends>=a-.3)))
        for j in eligible[-64:]:
            pa,pb,pp,ps,*_=notes[j]
            if a-pa+1e-9<min(.08,pb-pa):continue
            pairs.append((j,i))
    return pairs


def edge_features(notes,x,pairs):
    rows=[]
    for j,i in pairs:
        a,b,p,s,*_=notes[i];pa,pb,pp,ps,*_=notes[j]
        gap=a-pb
        rows.append([abs(p-pp)/12,(p-pp)/12,min(2,max(-1,gap)),a-pa,
          abs(math.log(max(b-a,.03)/max(pb-pa,.03))),abs(s-ps),
          abs(float(x[i,7]-x[j,7])),abs(float(x[i,8]-x[j,8])),
          float(x[i,14]),float(x[j,14]),float(x[i,10]),float(x[j,10])])
    return np.asarray(rows,dtype=np.float32).reshape((-1,12))


def hand_scores(x):
    qe=np.clip((.5+.5*x[:,2])*(1-.35*x[:,14]),.01,.99)
    qm=np.clip(.1+.8*x[:,7]+.05*np.maximum(x[:,15],x[:,16]),.01,.99)
    return qe,qm


def heuristic_affinity(edge_x):
    if not len(edge_x):return np.empty(0)
    return np.exp(-edge_x[:,0]-np.maximum(0,edge_x[:,2])/.5-.5*edge_x[:,4])


def select(notes,qe,qm,pairs,affinity,threshold=.3,link_weight=.03):
    """DP com cortes somente em ataques disponíveis, sem estender sustentações.

    Preserva as alternativas de entrada. Pontua existência, papel e afinidade
    separadamente. Como o baseline, pode interromper a cauda no próximo ataque.
    """
    n=len(notes)
    if not n:return []
    rate=np.asarray(qe)*np.asarray(qm)-threshold
    incoming=[[] for _ in notes]
    for (j,i),a in zip(pairs,affinity):incoming[i].append((j,float(a)))
    f=np.zeros(n);previous=np.full(n,-1,dtype=int)
    durations=np.asarray([b-a for a,b,*_ in notes]);completed=np.zeros(n)
    old_best=0.;old_index=-1;cursor=0
    by_end=sorted(range(n),key=lambda i:notes[i][1])
    for i,(a,b,p,s,*_) in enumerate(notes):
        while cursor<n and notes[by_end[cursor]][1]<a-2:
            j=by_end[cursor]
            if completed[j]>old_best:old_best=float(completed[j]);old_index=j
            cursor+=1
        best=old_best;parent=old_index
        for j,aff in incoming[i]:
            pa,pb,pp,ps,*_=notes[j]
            played=min(pb,a)-pa
            value=f[j]+rate[j]*played-link_weight*(1-aff)
            if value>best:best=float(value);parent=j
        f[i]=best;previous[i]=parent;completed[i]=best+rate[i]*(b-a)
    end=int(np.argmax(completed))
    if completed[end]<=0:return []
    chain=[]
    while end>=0:chain.append(end);end=int(previous[end])
    chain.reverse();out=[]
    for k,i in enumerate(chain):
        a,b,p,s,*_=notes[i]
        if k+1<len(chain):b=min(b,notes[chain[k+1]][0])
        if b>a:out.append([a,b,int(p),s])
    return out
