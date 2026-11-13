"""Controles sintéticos pequenos com altura/stems conhecidos; não benchmark representativo."""
import argparse
import json
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--essentia-path', type=Path)
    args = parser.parse_args()
    if args.essentia_path:
        sys.path.insert(0, str(args.essentia_path.resolve()))
    import numpy as np
    import soundfile as sf
    import essentia.standard as es

    sr = 44100
    folder = args.run / 'synthetic-controls'
    folder.mkdir(exist_ok=False)
    manifest = json.loads((args.run / 'manifest.json').read_text())
    settings = {k: v for k, v in manifest['melodia'].items() if k not in ('equalLoudness', 'other_parameters')}
    notes = [[0.1 + i * 0.6, 0.6 + i * 0.6, p] for i, p in enumerate([55, 57, 53, 55])]
    riff = [[0.1, 0.2, 50], [0.25, 0.35, 50], [0.4, 0.6, 62], [0.65, 0.9, 57],
            [1.15, 1.4, 56], [1.45, 1.7, 55], [1.75, 2.05, 53], [2.1, 2.2, 50],
            [2.25, 2.35, 53], [2.4, 2.5, 55]]
    cases = [
        ('pure-tone', notes, [(1, 1)], []),
        ('rich-harmonics', notes, [(1, 0.7), (2, 0.5), (3, 0.4), (4, 0.2)], []),
        ('weak-fundamental', notes, [(1, 0.03), (2, 0.7), (3, 1), (4, 0.3), (6, 0.4)], []),
        ('missing-fundamental', notes, [(2, 0.7), (3, 1), (4, 0.3), (6, 0.4)], []),
        ('fast-repeated-attacks', riff, [(1, 0.7), (2, 0.5), (3, 0.4)], []),
        ('high-melody-over-bass', [[a, b, p + 19] for a, b, p in notes], [(1, 0.3), (2, 0.1)],
         [[0.1, 2.4, 43]]),
    ]

    def synth(events, partials, duration):
        output = np.zeros(round(duration * sr), dtype=np.float32)
        for start, end, midi in events:
            a, b = round(start * sr), round(end * sr)
            t = np.arange(b - a) / sr
            hz = 440 * 2 ** ((midi - 69) / 12)
            wave = sum(gain * np.sin(2 * np.pi * hz * harmonic * t) for harmonic, gain in partials)
            envelope = np.minimum(1, t / 0.005) * np.minimum(1, (end - start - t) / 0.01)
            output[a:b] += wave * envelope
        return output

    result = {'parameters': settings, 'warning': 'Six deterministic pilot controls. Reference is the designated generated lead, not inferred from a model.', 'cases': []}
    for name, lead, partials, bass in cases:
        duration = 2.7
        lead_audio = synth(lead, partials, duration)
        bass_audio = synth(bass, [(1, 0.8), (2, 0.3)], duration)
        mixed = lead_audio + bass_audio
        gain = 0.8 / max(float(np.max(np.abs(mixed))), 1e-6)
        sf.write(folder / f'{name}.wav', mixed * gain, sr, subtype='FLOAT')
        sf.write(folder / f'{name}-lead.wav', lead_audio * gain, sr, subtype='FLOAT')
        if bass:
            sf.write(folder / f'{name}-bass.wav', bass_audio * gain, sr, subtype='FLOAT')
        filtered = es.EqualLoudness(sampleRate=sr)(mixed * gain)
        started = time.perf_counter()
        pitch, confidence = es.PredominantPitchMelodia(**settings)(filtered)
        elapsed = time.perf_counter() - started
        times = np.arange(len(pitch)) * 128 / sr
        expected = np.full(len(pitch), np.nan)
        core = np.zeros(len(pitch), dtype=bool)
        for start, end, midi in lead:
            expected[(times >= start) & (times < end)] = midi
            core |= (times >= start + 0.05) & (times < end - 0.05)
        voiced = (pitch > 0) & (confidence > 0)
        estimate = np.full(len(pitch), np.nan)
        estimate[voiced] = 69 + 12 * np.log2(pitch[voiced] / 440)
        present = np.isfinite(expected)
        correct = voiced & (np.abs(estimate - expected) < 0.5)
        chroma = voiced & (np.abs((estimate - expected + 6) % 12 - 6) < 0.5)
        percent = lambda mask, total: float(100 * mask.sum() / max(int(total.sum()), 1))
        metrics = {'name': name, 'seconds': elapsed,
                   'reference': {'lead': lead, 'bass': bass, 'partials': partials, 'duration': duration},
                   'rawPitchAccuracyPct': percent(correct & present, present),
                   'rawChromaAccuracyPct': percent(chroma & present, present),
                   'corePitchAccuracyPct': percent(correct & core, core),
                   'voicingRecallPct': percent(voiced & present, present),
                   'falseAlarmPct': percent(voiced & ~present, ~present)}
        np.savez_compressed(folder / f'{name}.npz', times=times, pitch=pitch,
                            confidence=confidence, reference_midi=expected, reference_core=core)
        result['cases'].append(metrics)
        print(json.dumps(metrics), flush=True)
    (folder / 'results.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
