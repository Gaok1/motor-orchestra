"""Ablações de vozeamento/contexto sobre os WAVs congelados de um run."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--essentia-path', type=Path)
    args = parser.parse_args()
    if args.essentia_path:
        sys.path.insert(0, str(args.essentia_path.resolve()))
    import numpy as np
    import librosa
    import essentia.standard as es
    from transcribe import _inference_input

    manifest = json.loads((args.run / 'manifest.json').read_text())
    report = {'warning': 'Independent estimators, no annotated ground truth. Guessed frames retain negative confidence.', 'songs': []}
    windows = [(1.126, 1.265), (3.124, 3.264), (5.134, 5.285), (7.132, 7.283)]
    configs = [
        ('guess-unvoiced', {'guessUnvoiced': True}, None),
        ('voicing-tolerance-1', {'voicingTolerance': 1.0}, None),
        ('prefix-16-default', {}, 16),
    ]
    for song in manifest['songs']:
        folder = args.run / song['id']
        result = {'id': song['id'], 'variants': []}
        with _inference_input(folder / 'audio.wav') as (path, scale, tuning):
            assert abs(scale - song['time_scale']) < 1e-12, 'afinação divergiu do snapshot'
            audio, _ = librosa.load(path, sr=44100, mono=True, dtype=np.float32)
            filtered = es.EqualLoudness(sampleRate=44100)(np.ascontiguousarray(audio))
            for name, changes, prefix_seconds in configs:
                destination = folder / f'melodia-{name}.json'
                if destination.exists():
                    raise FileExistsError(f'{destination}: preserve o resultado anterior ou crie outro run')
                settings = {key: value for key, value in manifest['melodia'].items()
                            if key not in ('equalLoudness', 'other_parameters')}
                settings.update(changes)
                signal = filtered if prefix_seconds is None else filtered[:round(prefix_seconds / scale * 44100)]
                started = time.perf_counter()
                pitch, confidence = es.PredominantPitchMelodia(**settings)(signal)
                elapsed = time.perf_counter() - started
                times = np.arange(len(pitch)) * (128 / 44100) * scale
                values = {'id': song['id'], 'variant': name, 'parameters': settings,
                          'time_domain': 'original recording seconds',
                          'pitch_domain': 'tuning-normalized analysis Hz', 'time_scale': scale,
                          'tuning_cents': tuning * 100, 'hop_seconds': 128 / 44100 * scale,
                          'source_window_seconds': [0, song['duration'] if prefix_seconds is None else prefix_seconds],
                          'frames': [[round(float(t), 6), round(float(p), 5), round(float(c), 6)]
                                     for t, p, c in zip(times, pitch, confidence)]}
                destination.write_text(json.dumps(values, allow_nan=False) + '\n')
                np.savez_compressed(folder / f'melodia-{name}.npz', times=times, pitch=pitch, confidence=confidence)
                midi = np.full(len(pitch), -1, dtype=int)
                valid = pitch > 0
                midi[valid] = np.rint(69 + 12 * np.log2(pitch[valid] / 440)).astype(int)
                diagnostic = []
                for a, b in windows:
                    mask = (times >= a) & (times < b)
                    hist = lambda subset: {int(p): int(np.sum(midi[subset] == p)) for p in np.unique(midi[subset]) if p >= 0}
                    diagnostic.append({'start': a, 'end': b, 'frames': int(mask.sum()),
                                       'voicedPitchCounts': hist(mask & (confidence > 0)),
                                       'guessedPitchCounts': hist(mask & (confidence < 0))})
                metrics = {'name': name, 'seconds': elapsed, 'source_window_seconds': values['source_window_seconds'],
                           'voiced_fraction': float(np.mean(valid & (confidence > 0))),
                           'guessed_fraction': float(np.mean(valid & (confidence < 0))),
                           'confidence_range': [float(confidence.min()), float(confidence.max())],
                           'diagnostic_windows': diagnostic}
                result['variants'].append(metrics)
                print(json.dumps({'id': song['id'], **metrics}), flush=True)
        report['songs'].append(result)
        (args.run / 'melodia-variants.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
