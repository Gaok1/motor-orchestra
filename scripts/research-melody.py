"""Experimento isolado: mapas Basic Pitch e guia MELODIA, sem alterar caches do app.

./run.sh scripts/research-melody.py --essentia-path /tmp/motor-orchestra-essentia
"""
import argparse
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import platform
import resource
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--songs', nargs='+', default=['0FCvzsVlXpQ', 'PJ1yqbr8Y50'])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--essentia-path', type=Path)
    parser.add_argument('--min-frequency', type=float, default=80)
    parser.add_argument('--max-frequency', type=float, default=2000)
    args = parser.parse_args()
    if args.essentia_path:
        sys.path.insert(0, str(args.essentia_path.resolve()))

    import numpy as np
    import librosa
    import essentia
    import essentia.standard as es
    from transcribe import _inference_input, _decode_notes

    logging.disable(logging.WARNING)
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model, run_inference
        from basic_pitch.note_creation import model_frames_to_time
    finally:
        logging.disable(logging.NOTSET)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    output = args.output or ROOT / 'downloads' / 'research' / stamp
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    snapshot = output / 'snapshot'
    snapshot.mkdir()
    for path in [*ROOT.glob('*.mjs'), *ROOT.glob('*.py'), *ROOT.glob('*.md'),
                 *ROOT.glob('*.html'), *ROOT.glob('*.css'), ROOT / 'requirements.txt', ROOT / 'run.sh',
                 *ROOT.glob('scripts/*.*'), *ROOT.glob('tests/*.py'), *ROOT.glob('tests/*.mjs'),
                 *ROOT.glob('tests/fixtures/*.mjs')]:
        dest = snapshot / path.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
    git = lambda *a: subprocess.run(['git', *a], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    (output / 'working-tree.patch').write_text(git('diff', '--binary'))
    (output / 'staged.patch').write_text(git('diff', '--cached', '--binary'))
    versions = {name: importlib.metadata.version(name) for name in
                ['basic-pitch', 'librosa', 'numpy', 'onnxruntime']}
    model_path = Path(ICASSP_2022_MODEL_PATH)
    model_files = [model_path] if model_path.is_file() else sorted(p for p in model_path.rglob('*') if p.is_file())
    manifest = {
        'created_utc': stamp, 'git_head': git('rev-parse', 'HEAD').strip(),
        'git_status': git('status', '--porcelain=v1'), 'python': sys.version,
        'platform': platform.platform(), 'logical_cpus': os.cpu_count(),
        'cpu_model': next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines()
                           if line.startswith('model name')), None) if Path('/proc/cpuinfo').exists() else None,
        'versions': {**versions, 'essentia': essentia.__version__},
        'source_hashes': {str(p.relative_to(snapshot)): digest(p) for p in sorted(snapshot.rglob('*')) if p.is_file()},
        'model_hashes': {str(p.relative_to(model_path.parent)): digest(p) for p in model_files},
        'melodia': {'sampleRate': 44100, 'hopSize': 128, 'frameSize': 2048,
                    'minFrequency': args.min_frequency, 'maxFrequency': args.max_frequency,
                    'guessUnvoiced': False, 'equalLoudness': True, 'other_parameters': 'library defaults'},
        'measurement': 'One pass per song, shared model instance. Not five warm runs or a controlled cold benchmark.',
        'songs': [],
    }
    start = time.perf_counter()
    model = Model(ICASSP_2022_MODEL_PATH)
    manifest['model_load_seconds'] = time.perf_counter() - start
    save_json(output / 'manifest.json', manifest)
    print(f'OUTPUT {output}', flush=True)

    for video_id in args.songs:
        source = ROOT / 'downloads' / video_id
        folder = output / video_id
        folder.mkdir()
        for name in ['audio.wav', 'notes.json', 'title.txt']:
            shutil.copy2(source / name, folder / name)
        cached = json.loads((folder / 'notes.json').read_text())
        metrics = {'id': video_id, 'title': cached['title'], 'duration': cached['duration'],
                   'input_hashes': {name: digest(folder / name) for name in ['audio.wav', 'notes.json']}}
        started = time.perf_counter()
        with _inference_input(folder / 'audio.wav') as (analysis_path, scale, tuning):
            metrics['tuning_seconds'] = time.perf_counter() - started
            metrics.update(time_scale=scale, tuning_cents=tuning * 100)
            started = time.perf_counter()
            raw = run_inference(analysis_path, model)
            metrics['basic_pitch_seconds'] = time.perf_counter() - started
            times = model_frames_to_time(len(raw['note'])) * scale
            # Antes de qualquer decodificação. Mesmo relógio original usado no guia.
            np.savez_compressed(folder / 'basic-pitch-raw.npz', **raw, times=times)
            started = time.perf_counter()
            decoded = _decode_notes(raw, 0.25, 0.15)
            events = sorted([[round(float(times[s]), 3), round(float(times[e]), 3), int(p), round(float(a), 3)]
                             for s, e, p, a in decoded], key=lambda n: (n[0], n[2]))
            metrics['decode_high_seconds'] = time.perf_counter() - started
            save_json(folder / 'decoded-high.json', events)
            cached_events = [n[:4] for n in cached['density']['alta']]
            metrics['exact_match_cached_high'] = events == cached_events
            metrics['candidate_counts'] = {'cached': len(cached_events), 'fresh': len(events)}

            started = time.perf_counter()
            audio, _ = librosa.load(analysis_path, sr=44100, mono=True, dtype=np.float32)
            metrics['guide_load_seconds'] = time.perf_counter() - started
            started = time.perf_counter()
            filtered = es.EqualLoudness(sampleRate=44100)(np.ascontiguousarray(audio))
            metrics['equal_loudness_seconds'] = time.perf_counter() - started
            started = time.perf_counter()
            pitch, confidence = es.PredominantPitchMelodia(
                sampleRate=44100, hopSize=128, frameSize=2048,
                minFrequency=args.min_frequency, maxFrequency=args.max_frequency,
                guessUnvoiced=False,
            )(filtered)
            metrics['melodia_seconds'] = time.perf_counter() - started
            # Pitch permanece no domínio de afinação da análise, como o MIDI do
            # Basic Pitch. Tempo volta à gravação original também para MELODIA.
            guide_times = np.arange(len(pitch)) * (128 / 44100) * scale
            np.savez_compressed(folder / 'melodia-raw.npz', times=guide_times, pitch=pitch, confidence=confidence)
            guide = {'id': video_id, 'time_domain': 'original recording seconds',
                     'pitch_domain': 'tuning-normalized analysis Hz; matches symbolic MIDI domain',
                     'time_scale': scale, 'tuning_cents': tuning * 100,
                     'hop_seconds': 128 / 44100 * scale,
                     'frames': [[round(float(t), 6), round(float(f), 5), round(float(c), 6)]
                                for t, f, c in zip(guide_times, pitch, confidence)]}
            save_json(folder / 'melodia.json', guide)
            metrics['melodia_frames'] = len(pitch)
            metrics['melodia_voiced_fraction'] = float(np.mean((pitch > 0) & (confidence > 0)))
            metrics['confidence_range'] = [float(confidence.min()), float(confidence.max())]
        # Linux: KiB, máximo cumulativo do processo; não é RSS adicional isolado.
        metrics['process_peak_rss_kib_cumulative'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        save_json(folder / 'metrics.json', metrics)
        manifest['songs'].append(metrics)
        save_json(output / 'manifest.json', manifest)
        print(json.dumps(metrics, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
