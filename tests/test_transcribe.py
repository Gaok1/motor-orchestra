"""Decodificação real do basic-pitch em ativações controladas; sem baixar modelos."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

AVAILABLE = importlib.util.find_spec("numpy") is not None and importlib.util.find_spec("basic_pitch") is not None
if AVAILABLE:
    import numpy as np
    from transcribe import DENSITIES, _decode_notes, _merge_splits, _tuning_offset, _inference_input


@unittest.skipUnless(AVAILABLE, "Execute ./run.sh -m unittest discover -s tests para testar a transcrição")
class TuningTests(unittest.TestCase):
    sr = 22050

    def tone(self, midi=69, offset=0):
        t = np.arange(2 * self.sr) / self.sr
        frequency = 440 * 2 ** ((midi + offset - 69) / 12)
        return (0.6 * np.sin(2 * np.pi * frequency * t)).astype(np.float32)

    def test_detects_flat_and_sharp_recordings(self):
        for offset in (-0.38, 0.27):
            with self.subTest(offset=offset):
                self.assertAlmostEqual(_tuning_offset(self.tone(offset=offset), self.sr), offset, delta=0.025)

    def test_tuned_music_silence_and_noise_are_not_retuned(self):
        chord = sum(self.tone(midi) for midi in (60, 64, 67)) / 3
        noise = np.random.default_rng(7).normal(0, 0.1, 2 * self.sr).astype(np.float32)
        for audio in (chord, self.tone(offset=0.07), np.zeros(2 * self.sr), noise):
            with self.subTest(rms=float(np.sqrt(np.mean(audio ** 2)))):
                self.assertEqual(_tuning_offset(audio, self.sr), 0)

    def test_normalization_keeps_original_audio_and_source_timing(self):
        import soundfile as sf
        import librosa

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.wav'
            sf.write(path, self.tone(offset=-0.38), self.sr, subtype='FLOAT')
            original = path.read_bytes()
            with _inference_input(path) as (normalized, time_scale, tuning):
                self.assertNotEqual(str(path), str(normalized))
                self.assertAlmostEqual(tuning, -0.38, delta=0.025)
                audio, sr = sf.read(normalized)
                self.assertAlmostEqual(len(audio) / sr * time_scale, 2, places=9)
                pitch, magnitude = librosa.piptrack(y=audio, sr=sr)
                peak = pitch[np.unravel_index(magnitude.argmax(), magnitude.shape)]
                self.assertAlmostEqual(float(librosa.hz_to_midi(peak)), 69, delta=0.04)
            self.assertFalse(Path(normalized).exists())
            self.assertEqual(path.read_bytes(), original)

    def test_tuned_recording_uses_original_path_without_temporary_file(self):
        import soundfile as sf

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.wav'
            sf.write(path, self.tone(), self.sr)
            with _inference_input(path) as (normalized, time_scale, tuning):
                self.assertEqual(normalized, path)
                self.assertEqual((time_scale, tuning), (1, 0))


@unittest.skipUnless(AVAILABLE, "Execute ./run.sh -m unittest discover -s tests para testar a transcrição")
class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.frames = np.zeros((100, 88))
        self.onsets = np.zeros_like(self.frames)

    def decode(self, onset=0.25, frame=0.15):
        return _decode_notes({"note": self.frames, "onset": self.onsets}, onset, frame)

    def test_recovers_fast_notes_in_all_densities(self):
        expected = [(10, 17, 60), (25, 32, 62), (40, 47, 64), (55, 62, 65)]
        for s, e, pitch in expected:
            self.frames[s:e, pitch - 21] = 0.8
            self.onsets[s, pitch - 21] = 0.9
        for thresholds in DENSITIES.values():
            with self.subTest(thresholds=thresholds):
                self.assertEqual(sorted(tuple(n[:3]) for n in self.decode(*thresholds)), expected)

    def test_short_noise_without_attack_is_not_recovered(self):
        self.frames[10:17, 39] = 0.8
        self.assertEqual(self.decode(), [])
        self.onsets[10, 39] = 0.3
        self.assertEqual(self.decode(), [])

    def test_high_density_recovers_soft_high_notes_with_explicit_attacks(self):
        expected = [(10, 17, 84), (25, 32, 86), (40, 47, 88)]
        for s, e, pitch in expected:
            self.frames[s:e, pitch - 21] = 0.25
            self.onsets[s, pitch - 21] = 0.4
        self.assertEqual(sorted(tuple(n[:3]) for n in self.decode()), expected)
        self.assertEqual(self.decode(*DENSITIES['normal']), [])

    def test_long_note_is_not_duplicated_or_truncated(self):
        self.frames[10:60, 39] = 0.8
        self.onsets[10, 39] = 0.9
        notes = self.decode()
        self.assertEqual([tuple(n[:3]) for n in notes], [(10, 60, 60)])

    def test_decoder_does_not_modify_model_outputs(self):
        self.frames[:, 0] = 0.6  # fora do limite: a biblioteca zeraria essa coluna
        self.onsets[10, 0] = 0.9
        before = self.frames.copy(), self.onsets.copy()
        self.decode()
        np.testing.assert_array_equal(self.frames, before[0])
        np.testing.assert_array_equal(self.onsets, before[1])

    def test_false_split_is_merged_but_moderate_reattack_after_valley_is_kept(self):
        notes = [(5, 25, 60, 0.6), (26, 50, 60, 0.6)]
        self.frames[5:50, 39] = 0.6
        self.onsets[26, 39] = 0.5
        merged = _merge_splits(notes, self.onsets, self.frames)
        self.assertEqual([n[:3] for n in merged], [[5, 50, 60]])
        self.frames[24:26, 39] = 0.1
        self.assertEqual([n[:3] for n in _merge_splits(notes, self.onsets, self.frames)],
                         [[5, 25, 60], [26, 50, 60]])

    def test_strong_repeated_attacks_and_real_rests_are_preserved(self):
        self.onsets[26, 39] = 0.8
        notes = [(5, 25, 60, 0.6), (26, 50, 60, 0.6), (60, 80, 60, 0.6)]
        self.assertEqual(len(_merge_splits(notes, self.onsets)), 3)

    def test_nested_fragment_does_not_shorten_sustain(self):
        notes = [(5, 80, 60, 0.6), (20, 30, 60, 0.5)]
        self.assertEqual(_merge_splits(notes, self.onsets)[0][1], 80)

    def test_silence_has_no_notes(self):
        self.assertEqual(self.decode(), [])
