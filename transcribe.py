"""Transcrição polifônica com o basic-pitch (Spotify), rodando localmente via ONNX.

O modelo devolve eventos de nota (início, fim, altura MIDI, intensidade, curva fina de
afinação). A saída da rede é convertida em notas com três níveis de densidade: limiares mais
baixos aceitam notas mais fracas, o que dá material aos motores extras. O arranjo é feito no
navegador (score.mjs).
"""

import logging

import numpy as np

# Faixa útil para os motores: Si0 (~31 Hz) até ~Dó8.
MIN_FREQ = 30.0
MAX_FREQ = 4200.0
# (limiar de ataque, limiar de quadro) do basic-pitch; "normal" é o padrão da biblioteca.
DENSITIES = {"normal": (0.5, 0.3), "media": (0.35, 0.2), "alta": (0.25, 0.15)}


def _fine_curve(contours, s, e, midi, half=4):
    """Afinação fina da nota, em semitons, quadro a quadro: centróide de 3 bins em volta do pico do
    contorno (3 bins por semitom), numa janela de ±4 bins (±1,3 semitom) em volta da nota. O
    get_pitch_bends do basic-pitch usa argmax (degraus de 1/3 de semitom) numa janela de ±8
    semitons, que pega o contorno de notas vizinhas. Quadros com contorno fraco ficam NaN."""
    center = 3 * (midi - 21)                     # bin k ↔ 27,5·2^(k/36) Hz; Lá0 = MIDI 21
    lo, hi = max(0, center - half), min(contours.shape[1], center + half + 1)
    w = contours[s:e, lo:hi]
    if w.size == 0:
        return None
    pk = w.argmax(axis=1)
    rows = np.arange(len(pk))
    left = w[rows, np.maximum(pk - 1, 0)]
    mid = w[rows, pk]
    right = w[rows, np.minimum(pk + 1, w.shape[1] - 1)]
    curve = (lo + pk + (right - left) / (left + mid + right + 1e-9) - center) / 3.0
    curve[mid <= 0.1] = np.nan
    return curve


def _bends(curve, bias):
    """Tira o desvio fixo da música (viés do modelo + afinação da gravação), preenche quadros
    fracos, suaviza, guarda um valor a cada 2 quadros (~43 Hz) e omite notas sem variação."""
    if curve is None or np.isnan(curve).all():
        return None
    from scipy.signal import medfilt

    b = curve - bias
    idx = np.arange(len(b))
    ok = ~np.isnan(b)
    b = np.interp(idx, idx[ok], b[ok])
    if len(b) >= 3:
        b = medfilt(b, 3)
        b = np.convolve(np.pad(b, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    b = np.clip(b, -1.5, 1.5)[::2]
    if np.abs(b).max() < 0.08:
        return None
    return [round(float(x), 2) for x in b]


# O basic-pitch quebra notas contínuas em pedaços colados da mesma altura. No gabarito sintético
# (sem nenhuma nota repetida colada) 67% das notas saíram assim. A força do ataque que a própria
# rede estima separa bem: re-ataques reais 0,81–0,94, quebras falsas 0,37–0,67. Abaixo de 0,7
# os pedaços são juntados (93% das quebras falsas, 4% dos re-ataques reais).
SPLIT_MAX_GAP = 3        # quadros (~35 ms) entre os pedaços
SPLIT_MAX_ONSET = 0.7


def _merge_splits(notes, onsets):
    by_pitch = {}
    for s, e, pitch, amp in notes:
        by_pitch.setdefault(pitch, []).append([s, e, pitch, amp])
    merged = []
    for pitch, run in by_pitch.items():
        run.sort()
        cur = run[0]
        for nxt in run[1:]:
            attack = onsets[max(0, nxt[0] - 1):nxt[0] + 2, pitch - 21].max()
            if nxt[0] - cur[1] <= SPLIT_MAX_GAP and attack < SPLIT_MAX_ONSET:
                cur = [cur[0], nxt[1], pitch, max(cur[3], nxt[3])]
            else:
                merged.append(cur)
                cur = nxt
        merged.append(cur)
    return merged


def transcribe(wav_path):
    # O basic-pitch avisa ao importar que TensorFlow/CoreML/TFLite não estão instalados;
    # aqui só usamos o backend ONNX, então os avisos são ruído.
    logging.disable(logging.WARNING)
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model, predict
        from basic_pitch.note_creation import model_frames_to_time, output_to_notes_polyphonic
    finally:
        logging.disable(logging.NOTSET)

    import librosa

    output, _, _ = predict(
        str(wav_path), Model(ICASSP_2022_MODEL_PATH),
        minimum_frequency=MIN_FREQ, maximum_frequency=MAX_FREQ,
    )
    contours = output["contour"]
    times = model_frames_to_time(contours.shape[0])
    raw = {}
    for name, (onset, frame) in DENSITIES.items():
        # mesmos passos de basic_pitch.note_creation.model_output_to_notes, mas com os índices
        # de quadro, para calcular a curva fina de afinação de cada nota
        notes = output_to_notes_polyphonic(
            output["note"], output["onset"], onset_thresh=onset, frame_thresh=frame,
            min_note_len=11, infer_onsets=True, max_freq=MAX_FREQ, min_freq=MIN_FREQ, melodia_trick=True,
        )
        raw[name] = [
            (s, e, int(pitch), float(amp), _fine_curve(contours, s, e, int(pitch)))
            for s, e, pitch, amp in _merge_splits(notes, output["onset"])
        ]
    # Desvio fixo: mediana da afinação das notas. No gabarito sintético (afinado em Lá 440) o
    # basic-pitch dá +0,31 semitom em todas as notas: é viés do modelo, não da música.
    medians = [np.nanmedian(c) for *_, c in raw["media"] if c is not None and not np.isnan(c).all()]
    bias = float(np.median(medians)) if medians else 0.0
    density = {}
    for name, notes in raw.items():
        # [início, fim, midi, intensidade, curva de afinação ou None]
        density[name] = sorted(
            ([round(float(times[s]), 3), round(float(times[e]), 3), pitch, round(amp, 3), _bends(curve, bias)]
             for s, e, pitch, amp, curve in notes),
            key=lambda n: (n[0], n[2]),
        )
    return {
        "duration": float(librosa.get_duration(path=str(wav_path))),
        "notes": density.pop("normal"),
        "density": density,
    }
