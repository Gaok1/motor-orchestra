"""Relógio e métricas comuns aos experimentos de múltiplas alturas."""


def klapuri_frame_mask(audio, settings):
    """Reconstitui os quadros omitidos quando não há picos de saliência.

    MultiPitchKlapuri usa `continue` sem adicionar um quadro vazio à saída.
    A equivalência do número de quadros deve ser verificada em cada execução.
    Front-end baseado no fonte público da Essentia, não em um limiar de energia.
    """
    import numpy as np
    import essentia.standard as es
    sr, size, hop = settings['sampleRate'], settings['frameSize'], settings['hopSize']
    window = es.Windowing(size=size, zeroPadding=3*size, type='hann')
    spectrum = es.Spectrum(size=4*size)
    peaks = es.SpectralPeaks(minFrequency=1, maxFrequency=20000, maxPeaks=100,
                             sampleRate=sr, magnitudeThreshold=0, orderBy='magnitude')
    salience = es.PitchSalienceFunction(binResolution=10, referenceFrequency=55,
                                        magnitudeThreshold=40, magnitudeCompression=1,
                                        numberHarmonics=10, harmonicWeight=.8)
    pitch_peaks = es.PitchSalienceFunctionPeaks(binResolution=10, referenceFrequency=55,
                                               minFrequency=settings['minFrequency'], maxFrequency=settings['maxFrequency'])
    mask=[]
    for frame in es.FrameGenerator(audio, frameSize=size, hopSize=hop, startFromZero=False):
        frequencies,magnitudes=peaks(spectrum(window(frame)))
        bins,_=pitch_peaks(salience(frequencies,magnitudes))
        mask.append(len(bins)>0)
    return np.asarray(mask,dtype=bool)


def pitch_set_metrics(pitches,times,reference,lead):
    import numpy as np
    hits=pred=truth=lead_hits=lead_total=0
    core_hits=core_total=0
    for frame,t in zip(pitches,times):
        estimates=[69+12*np.log2(float(x)/440) for x in frame if x>0]
        refs=[p for a,b,p in reference if a<=t<b]
        targets=[p for a,b,p in lead if a<=t<b]
        core=[p for a,b,p in lead if a+.05<=t<b-.05]
        candidates=sorted((abs(p-q),i,j) for i,p in enumerate(estimates) for j,q in enumerate(refs) if abs(p-q)<.5)
        used_i,used_j=set(),set()
        for _,i,j in candidates:
            if i not in used_i and j not in used_j: used_i.add(i);used_j.add(j)
        hits+=len(used_i);pred+=len(estimates);truth+=len(refs)
        lead_hits+=sum(any(abs(p-q)<.5 for p in estimates) for q in targets);lead_total+=len(targets)
        core_hits+=sum(any(abs(p-q)<.5 for p in estimates) for q in core);core_total+=len(core)
    return dict(pitchSetPrecisionPct=100*hits/max(pred,1),pitchSetRecallPct=100*hits/max(truth,1),
                designatedLeadRecallPct=100*lead_hits/max(lead_total,1),coreLeadRecallPct=100*core_hits/max(core_total,1))
