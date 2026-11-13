"""Servidor local: baixa áudio do YouTube e extrai as notas para a orquestra de motores."""

import errno
import json
import math
import os
import re
import shutil
import subprocess
import threading
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / "downloads"
# Reaproveita os WAVs já baixados pelo PyMusicLooper, se existirem ao lado.
LOOPER_DOWNLOADS = ROOT.parent / "PyMusicLooper" / "downloads"
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
ANALYSIS_VERSION = 10
PORT = 8001
JOBS = {}
JOBS_LOCK = threading.Lock()
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/engine.mjs": ("engine.mjs", "text/javascript; charset=utf-8"),
    "/bells.mjs": ("bells.mjs", "text/javascript; charset=utf-8"),
    "/score.mjs": ("score.mjs", "text/javascript; charset=utf-8"),
    "/charts.mjs": ("charts.mjs", "text/javascript; charset=utf-8"),
    "/physics.mjs": ("physics.mjs", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}


def parse_video_id(raw_url):
    if not isinstance(raw_url, str):
        return None
    try:
        url = urlsplit(raw_url.strip())
        host = (url.hostname or "").lower()
        if url.scheme not in ("http", "https") or url.username or url.password:
            return None
        segments = [part for part in url.path.split("/") if part]
        if host == "youtu.be":
            video_id = segments[0] if segments else None
        elif host == "youtube.com" or host.endswith(".youtube.com"):
            if segments == ["watch"]:
                video_id = parse_qs(url.query).get("v", [None])[0]
            elif segments and segments[0] in ("shorts", "live", "embed"):
                video_id = segments[1] if len(segments) == 2 else None
            else:
                video_id = None
        else:
            return None
        return video_id if video_id and VIDEO_ID.fullmatch(video_id) else None
    except ValueError:
        return None


def set_job(video_id, **fields):
    with JOBS_LOCK:
        JOBS[video_id] = {**JOBS.get(video_id, {}), "id": video_id, **fields}


def download(video_id, folder, wav_path):
    import imageio_ffmpeg
    from yt_dlp import YoutubeDL

    cached = LOOPER_DOWNLOADS / video_id
    if (cached / "audio.wav").exists():
        temporary_wav = folder / "audio.tmp.wav"
        shutil.copy(cached / "audio.wav", temporary_wav)
        temporary_wav.replace(wav_path)
        if (cached / "title.txt").exists():
            shutil.copy(cached / "title.txt", folder / "title.txt")
        return

    set_job(video_id, message="Baixando áudio do YouTube...")
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(folder / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "cachedir": False,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    if info.get("is_live"):
        raise ValueError("Transmissões ao vivo não podem ser analisadas.")
    source_files = [
        path for path in folder.glob("source.*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl", ".json"))
    ]
    if len(source_files) != 1:
        raise RuntimeError("O download não produziu um arquivo de áudio.")

    set_job(video_id, message="Convertendo áudio...")
    temporary_wav = folder / "audio.tmp.wav"
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
            "-y", "-i", str(source_files[0]), "-vn", "-ac", "2", "-ar", "44100",
            "-c:a", "pcm_s16le", str(temporary_wav),
        ],
        check=True, capture_output=True, text=True,
    )
    temporary_wav.replace(wav_path)
    (folder / "title.txt").write_text(info.get("title") or video_id, encoding="utf-8")


def process_job(video_id):
    folder = DOWNLOADS / video_id
    wav_path = folder / "audio.wav"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        if not wav_path.exists():
            download(video_id, folder, wav_path)
        title_file = folder / "title.txt"
        title = title_file.read_text(encoding="utf-8") if title_file.exists() else video_id

        set_job(video_id, message="Transcrevendo as notas (basic-pitch)...")
        from transcribe import transcribe
        notes = transcribe(wav_path)
        set_job(video_id, message="Detectando a percussão...")
        from percussion import detect_drums
        result = {
            "id": video_id,
            "status": "ready",
            "analysis_version": ANALYSIS_VERSION,
            "title": title,
            **notes,
            "drums": detect_drums(wav_path),
        }
        write_result(folder / "notes.json", result)
        set_job(video_id, **result)
    except Exception as error:
        detail = str(error).strip() or type(error).__name__
        set_job(video_id, status="error", error=detail[-500:])


def write_result(path, result):
    """Publica só JSON completo; uma falha preserva o cache anterior."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="notes-", suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            json.dump(result, file, ensure_ascii=False, allow_nan=False)
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def valid_result(data, video_id):
    def number(value):
        return type(value) in (int, float) and math.isfinite(value)

    def notes(value):
        return isinstance(value, list) and all(
            isinstance(n, list) and len(n) in (4, 5)
            and all(number(v) for v in n[:4])
            and 0 <= n[0] < n[1] and 0 <= n[2] <= 127 and 0 <= n[3] <= 1
            and (len(n) == 4 or n[4] is None
                 or isinstance(n[4], list) and all(number(v) for v in n[4]))
            for n in value
        )

    return (
        isinstance(data, dict) and data.get("analysis_version") == ANALYSIS_VERSION
        and data.get("id") == video_id and data.get("status") == "ready"
        and isinstance(data.get("title"), str)
        and number(data.get("duration")) and data["duration"] > 0
        and notes(data.get("notes"))
        and isinstance(data.get("density"), dict)
        and all(notes(data["density"].get(key)) for key in ("media", "alta"))
        and isinstance(data.get("drums"), list)
        and all(isinstance(d, list) and len(d) == 3
                and number(d[0]) and d[0] >= 0 and d[1] in ("kick", "snare", "hat")
                and number(d[2]) and 0 <= d[2] <= 1 for d in data["drums"])
    )


def cached_result(video_id):
    folder = DOWNLOADS / video_id
    try:
        data = json.loads((folder / "notes.json").read_text(encoding="utf-8"))
        if valid_result(data, video_id) and (folder / "audio.wav").is_file():
            return data
    except (OSError, ValueError, OverflowError):
        # Cache ausente, incompleto ou ilegível: o próximo POST refaz a análise.
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, status_code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path, content_type):
        if not path.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with path.open("rb") as file:
            while chunk := file.read(1024 * 1024):
                self.wfile.write(chunk)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in STATIC:
            filename, content_type = STATIC[path]
            self.serve_file(ROOT / filename, content_type)
            return
        if path.startswith("/api/jobs/"):
            video_id = path.removeprefix("/api/jobs/")
            if not VIDEO_ID.fullmatch(video_id):
                self.send_json(404, {"error": "Música não encontrada."})
                return
            with JOBS_LOCK:
                job = JOBS.get(video_id)
            job = job or cached_result(video_id)
            self.send_json(200, job) if job else self.send_json(404, {"error": "Música não encontrada."})
            return
        if path.startswith("/audio/"):
            video_id = path.removeprefix("/audio/")
            if VIDEO_ID.fullmatch(video_id) and cached_result(video_id):
                self.serve_file(DOWNLOADS / video_id / "audio.wav", "audio/wav")
            else:
                self.send_error(404)
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/api/jobs":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 4096:
                raise ValueError
            video_id = parse_video_id(json.loads(self.rfile.read(size)).get("url"))
        except (ValueError, TypeError, json.JSONDecodeError, AttributeError):
            video_id = None
        if not video_id:
            self.send_json(400, {"error": "Cole um link válido de um vídeo do YouTube."})
            return

        with JOBS_LOCK:
            existing = JOBS.get(video_id)
            if not existing or existing.get("status") == "error":
                cached = cached_result(video_id)
                if cached:
                    JOBS[video_id] = cached
                else:
                    JOBS[video_id] = {"id": video_id, "status": "working", "message": "Iniciando..."}
                    threading.Thread(target=process_job, args=(video_id,), daemon=True).start()
        self.send_json(202, {"id": video_id})


def main():
    DOWNLOADS.mkdir(exist_ok=True)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise SystemExit(f"A porta {PORT} já está em uso. Encerre a instância anterior primeiro.") from None
        raise
    print(f"Abra http://127.0.0.1:{PORT} no navegador. Ctrl+C para encerrar.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
