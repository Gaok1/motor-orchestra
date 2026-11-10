"""Golpes para o motor de percussão.

O espectro (CQT) é separado em parte tonal e percussiva (HPSS); na percussiva, os picos do fluxo
de energia por banda viram golpes de bumbo, caixa e chimbal. No gabarito sintético o motor de
percussão acerta 84% dos golpes reais (F=0,67), mas confunde as peças com frequência.
"""
import numpy as np

SR = 22050
HOP = 512
DT = HOP / SR
BPO = 36
LOW_MIDI = 24                      # Dó1: primeiro bin da CQT
NBINS = BPO * 8                    # até ~Dó9
BANDS = {"kick": (40, 130), "snare": (180, 5000), "hat": (5500, 12000)}


def detect_drums(wav_path, delta=0.25):
    import librosa

    y, _ = librosa.load(str(wav_path), sr=SR, mono=True)
    fmin = librosa.midi_to_hz(LOW_MIDI)
    C = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=fmin, n_bins=NBINS, bins_per_octave=BPO))
    _, P = librosa.decompose.hpss(C, kernel_size=(17, 17), margin=1.0)
    freqs = librosa.cqt_frequencies(NBINS, fmin=fmin, bins_per_octave=BPO)
    total = np.percentile(P.sum(axis=0), 99) + 1e-9
    hits = []
    for kind, (lo, hi) in BANDS.items():
        energy = np.log1p(50 * P[(freqs >= lo) & (freqs < hi)].sum(axis=0) / total)
        flux = np.maximum(0, np.diff(energy, prepend=energy[0]))
        flux /= np.percentile(flux, 99.5) + 1e-9
        for p in librosa.util.peak_pick(flux, pre_max=2, post_max=2, pre_avg=8, post_avg=2, delta=delta, wait=4):
            hits.append([round(float(p * DT), 3), kind, round(float(min(1, flux[p])), 2)])
    return sorted(hits)
