import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "vendor"))
import libtorrent as lt


class EngineIntegrationTest(unittest.TestCase):
    def test_download_stops_and_seeding_requires_explicit_worker(self):
        with tempfile.TemporaryDirectory(prefix="substranslate-libtorrent-") as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            payload = b"example media " * 30000
            (source / "Movie.mkv").write_bytes(payload)
            storage = lt.file_storage()
            storage.add_file("Movie.mkv", len(payload))
            builder = lt.create_torrent(storage, 16384)
            lt.set_piece_hashes(builder, str(source))
            torrent_file = root / "source.torrent"
            torrent_file.write_bytes(lt.bencode(builder.generate()))
            info = lt.torrent_info(str(torrent_file))
            seeder = lt.session({"listen_interfaces": "127.0.0.1:0", "enable_dht": False,
                                 "enable_upnp": False, "enable_natpmp": False})
            params = lt.add_torrent_params()
            params.ti = info
            params.save_path = str(source)
            source_handle = seeder.add_torrent(params)
            self.assertTrue(wait_until(lambda: source_handle.status().is_seeding, 10))

            staging = root / "staging"
            staging.mkdir()
            saved_torrent = staging / "source.torrent"
            config = {"mode": "download", "magnet": f"magnet:?xt=urn:btih:{info.info_hash()}",
                      "infoHash": str(info.info_hash()), "staging": str(staging),
                      "torrentFile": str(saved_torrent),
                      "peer": {"host": "127.0.0.1", "port": seeder.listen_port()}}
            worker = launch(config)
            try:
                metadata = next_message(worker, "metadata", 20)
                self.assertEqual(metadata["files"][0]["path"], "Movie.mkv")
                worker.stdin.write('{"type":"select","indices":[0]}\n')
                worker.stdin.flush()
                next_message(worker, "completed", 30)
                self.assertEqual(worker.wait(timeout=5), 0)
                self.assertEqual((staging / "Movie.mkv").read_bytes(), payload)
                self.assertTrue(saved_torrent.is_file())
            finally:
                if worker.poll() is None:
                    worker.kill()
                worker.stdin.close()
                worker.stdout.close()
                worker.stderr.close()

            # A separate explicit worker is required to seed after completion.
            seed = launch({"mode": "seed", "staging": str(staging),
                           "torrentFile": str(saved_torrent), "indices": [0]})
            try:
                next_message(seed, "seeding", 20)
                seed.stdin.write('{"type":"cancel"}\n')
                seed.stdin.flush()
                self.assertEqual(seed.wait(timeout=5), 0)
            finally:
                if seed.poll() is None:
                    seed.kill()
                seed.stdin.close()
                seed.stdout.close()
                seed.stderr.close()


def wait_until(condition, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.1)
    return False


def launch(config):
    environment = dict(os.environ, PYTHONPATH=str(Path(__file__).parent / "vendor"))
    return subprocess.Popen([sys.executable, "-u", str(Path(__file__).parent / "engine.py"), json.dumps(config)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, env=environment)


def next_message(worker, kind, seconds):
    found = queue.Queue()

    def read():
        for line in worker.stdout:
            message = json.loads(line)
            if message["type"] in (kind, "error"):
                found.put(message)
                return

    threading.Thread(target=read, daemon=True).start()
    message = found.get(timeout=seconds)
    if message["type"] == "error":
        raise AssertionError(message["message"])
    return message


if __name__ == "__main__":
    unittest.main()
