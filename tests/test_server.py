"""Regressões da API/cache, sem downloads nem dependências de transcrição."""

import copy
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server

VIDEO = "dQw4w9WgXcQ"


def result():
    return {
        "id": VIDEO, "status": "ready", "analysis_version": server.ANALYSIS_VERSION,
        "title": "Música de teste", "duration": 2,
        "notes": [[0, 1, 69, 0.8, [0, 0.1]]],
        "density": {"media": [], "alta": []}, "drums": [[0, "kick", 1]],
    }


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = patch.object(server, "DOWNLOADS", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.jobs_patch = patch.object(server, "JOBS", {})
        self.jobs_patch.start()
        self.addCleanup(self.jobs_patch.stop)
        self.folder = self.root / VIDEO
        self.folder.mkdir()
        self.wav = self.folder / "audio.wav"
        self.wav.write_bytes(b"test audio")
        self.cache = self.folder / "notes.json"

    def test_valid_cache_round_trip(self):
        server.write_result(self.cache, result())
        self.assertEqual(server.cached_result(VIDEO), result())
        self.assertEqual(list(self.folder.glob("*.tmp")), [])

    def test_invalid_caches_are_misses(self):
        self.assertIsNone(server.cached_result(VIDEO))
        for raw in ('{"id":', 'null', '[]', '42', '\ufffd'):
            with self.subTest(raw=raw):
                self.cache.write_text(raw)
                self.assertIsNone(server.cached_result(VIDEO))
        self.cache.write_bytes(b'\xff')
        self.assertIsNone(server.cached_result(VIDEO))
        changes = [
            {"analysis_version": -1}, {"id": "wrong"}, {"status": "working"},
            {"duration": float("nan")}, {"duration": 0}, {"duration": 10 ** 400},
            {"notes": [[0, 1]]}, {"notes": [[0, 1, 69, float("inf")]]},
            {"density": {"media": None, "alta": []}}, {"drums": [[0, "unknown", 1]]},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.cache.write_text(json.dumps({**result(), **change}))
                self.assertIsNone(server.cached_result(VIDEO))

    def test_missing_audio_invalidates_cache(self):
        server.write_result(self.cache, result())
        self.wav.unlink()
        self.assertIsNone(server.cached_result(VIDEO))

    def test_failed_serialization_preserves_previous_cache(self):
        server.write_result(self.cache, result())
        invalid = {**result(), "duration": float("nan")}
        with self.assertRaises(ValueError):
            server.write_result(self.cache, invalid)
        self.assertEqual(server.cached_result(VIDEO), result())
        self.assertEqual(list(self.folder.glob("*.tmp")), [])

    def test_failed_replace_preserves_previous_cache(self):
        server.write_result(self.cache, result())
        with patch.object(Path, "replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                server.write_result(self.cache, {**result(), "title": "new"})
        self.assertEqual(server.cached_result(VIDEO), result())
        self.assertEqual(list(self.folder.glob("*.tmp")), [])

    def test_folder_failure_marks_job_as_error(self):
        server.set_job(VIDEO, status="working", message="Iniciando...")
        with patch.object(Path, "mkdir", side_effect=PermissionError("read-only folder")):
            server.process_job(VIDEO)
        self.assertEqual(server.JOBS[VIDEO]["status"], "error")
        self.assertIn("read-only folder", server.JOBS[VIDEO]["error"])

    def test_successful_processing_publishes_cache(self):
        data = result()
        transcription = {key: copy.deepcopy(data[key]) for key in ("duration", "notes", "density")}
        with patch.dict("sys.modules", {
            "transcribe": SimpleNamespace(transcribe=Mock(return_value=transcription)),
            "percussion": SimpleNamespace(detect_drums=Mock(return_value=data["drums"])),
        }), patch.object(server, "download") as download:
            server.process_job(VIDEO)
        download.assert_not_called()
        self.assertEqual(server.JOBS[VIDEO]["status"], "ready")
        self.assertEqual(server.cached_result(VIDEO)["notes"], data["notes"])

    def test_partial_looper_copy_is_not_published(self):
        self.wav.unlink()
        looper = self.root / "looper"
        (looper / VIDEO).mkdir(parents=True)
        (looper / VIDEO / "audio.wav").write_bytes(b"source")

        def failed_copy(source, destination):
            Path(destination).write_bytes(b"partial")
            raise OSError("copy interrupted")

        with patch.dict("sys.modules", {
            "imageio_ffmpeg": SimpleNamespace(), "yt_dlp": SimpleNamespace(YoutubeDL=Mock()),
        }), patch.object(server, "LOOPER_DOWNLOADS", looper), patch.object(server.shutil, "copy", failed_copy):
            server.process_job(VIDEO)
        self.assertFalse(self.wav.exists())
        self.assertEqual(server.JOBS[VIDEO]["status"], "error")

    def test_corrupt_cache_can_be_retried_and_working_jobs_are_reused(self):
        self.cache.write_text('{"interrupted":')
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01})
        worker.start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(httpd.shutdown)

        def request(method, path, body=None):
            connection = http.client.HTTPConnection(*httpd.server_address, timeout=3)
            try:
                connection.request(method, path, body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        self.assertEqual(request("GET", f"/api/jobs/{VIDEO}")[0], 404)
        # Hold the job in progress to verify duplicate submissions start only one worker.
        started, release = threading.Event(), threading.Event()

        def process(video_id):
            started.set()
            release.wait(3)

        with patch.object(server, "process_job", side_effect=process) as process_job:
            try:
                body = json.dumps({"url": f"https://youtu.be/{VIDEO}"})
                self.assertEqual(request("POST", "/api/jobs", body), (202, {"id": VIDEO}))
                self.assertTrue(started.wait(3))
                self.assertEqual(request("POST", "/api/jobs", body)[0], 202)
                self.assertEqual(request("GET", f"/api/jobs/{VIDEO}")[1]["status"], "working")
                process_job.assert_called_once_with(VIDEO)
            finally:
                release.set()


if __name__ == "__main__":
    unittest.main()
