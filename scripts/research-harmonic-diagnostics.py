"""Inspeção dos quatro conflitos 55/74: mapas BP e saliência espectral pré-contornos."""
import argparse
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--essentia-path', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.essentia_path:
        sys.path.insert(0, str(args.essentia_path.resolve()))
    import numpy as np
    import librosa
    import essentia.standard as es

    folder = args.run / '0FCvzsVlXpQ'
    raw = np.load(folder / 'basic-pitch-raw.npz')
    times = raw['times']
    windows = [(1.126, 1.265), (3.124, 3.264), (5.134, 5.285), (7.132, 7.283)]
    rows = []
    for start, end in windows:
        note_mask = (times >= start) & (times < end)
        onset_mask = (times >= start - 0.06) & (times < start + 0.06)
        row = {'start': start, 'end': end, 'basicPitch': [], 'frameEvidence': []}
        for midi in (55, 74):
            k = midi - 21
            row['basicPitch'].append({
                'midi': midi, 'noteMean': float(raw['note'][note_mask, k].mean()),
                'noteMax': float(raw['note'][note_mask, k].max()),
                'onsetPeakNearAttack': float(raw['onset'][onset_mask, k].max()),
                'contourPeakMean': float(raw['contour'][note_mask, 3 * k - 1:3 * k + 2].max(axis=1).mean()),
            })
        rows.append(row)

    # Reconstrução diagnóstica do front-end documentado no C++ oficial. Não
    # afirma identidade bit a bit com os estados internos do algoritmo completo.
    audio, _ = librosa.load(folder / 'audio.wav', sr=44100, duration=8)
    filtered = es.EqualLoudness(sampleRate=44100)(audio)
    window = es.Windowing(size=2048, zeroPadding=6144, type='hann')
    spectrum = es.Spectrum(size=8192)
    peaks = es.SpectralPeaks(minFrequency=1, maxFrequency=20000, maxPeaks=100,
                             sampleRate=44100, magnitudeThreshold=0, orderBy='magnitude')
    salience = es.PitchSalienceFunction(binResolution=10, referenceFrequency=55,
                                      magnitudeThreshold=40, magnitudeCompression=1,
                                      numberHarmonics=20, harmonicWeight=0.8)
    for i, frame in enumerate(es.FrameGenerator(filtered, frameSize=2048, hopSize=128, startFromZero=False)):
        t = i * 128 / 44100
        row = next((r for r in rows if r['start'] <= t < r['end']), None)
        if row is None:
            continue
        frequencies, magnitudes = peaks(spectrum(window(frame)))
        values = salience(frequencies, magnitudes)
        # ReferenceFrequency=55 Hz (MIDI 33), 10 cents/bin; máximo em ±20 cents.
        evidence = {str(midi): float(values[(midi - 33) * 10 - 2:(midi - 33) * 10 + 3].max())
                    for midi in (55, 74)}
        evidence.update(time=t, topMidi=round(float(33 + np.argmax(values) / 10), 2),
                        maxSalience=float(values.max()))
        row['frameEvidence'].append(evidence)
    for row in rows:
        frames = row['frameEvidence']
        row['frames'] = len(frames)
        row['meanSalience55'] = float(np.mean([f['55'] for f in frames]))
        row['meanSalience74'] = float(np.mean([f['74'] for f in frames]))
        row['fraction55HigherThan74'] = float(np.mean([f['55'] > f['74'] for f in frames]))
        row['topMidiFrameCounts'] = {str(midi): sum(f['topMidi'] == midi for f in frames)
                                    for midi in sorted({f['topMidi'] for f in frames})}
    result = {
        'warning': 'Not annotated ground truth; frame front-end diagnostic, not internal instrumentation of full MELODIA.',
        'run': str(args.run), 'id': '0FCvzsVlXpQ', 'time_domain': 'original recording seconds',
        'onset_window_seconds': [-0.06, 0.06], 'salience_bin_window_cents': [-20, 20],
        'processing': 'EqualLoudness -> centered Hann 2048 + 6144 zero padding -> Spectrum -> top 100 SpectralPeaks -> PitchSalienceFunction',
        'source': 'https://github.com/MTG/essentia/blob/master/src/algorithms/tonal/predominantpitchmelodia.cpp',
        'windows': rows,
    }
    destination = args.output or args.run / 'harmonic-diagnostics.json'
    destination.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(destination), 'windows': [{k: v for k, v in r.items() if k != 'frameEvidence'} for r in rows]}, indent=2))


if __name__ == '__main__':
    main()
