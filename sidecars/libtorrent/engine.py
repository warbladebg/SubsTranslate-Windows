"""One-shot libtorrent worker. JSON lines on stdout are consumed by Electron."""

import json
import queue
import sys
import threading
import time

import libtorrent as lt


def emit(kind, **values):
    print(json.dumps({"type": kind, **values}, separators=(",", ":")), flush=True)


def commands():
    pending = queue.Queue()

    def read():
        for line in sys.stdin:
            try:
                pending.put(json.loads(line))
            except json.JSONDecodeError:
                pending.put({"type": "invalid"})
        pending.put({"type": "cancel"})

    threading.Thread(target=read, daemon=True).start()
    return pending


def hash_string(handle):
    return str(handle.info_hash()).lower()


def normalized_files(torrent_info):
    storage = torrent_info.files()
    result = []
    for index in range(storage.num_files()):
        if storage.file_flags(index) & lt.file_flags_t.flag_symlink:
            raise ValueError("Torrent metadata contains a symbolic link")
        path = storage.file_path(index).replace("\\", "/")
        if not path or path.startswith("/") or any(part in ("", ".", "..") for part in path.split("/")):
            raise ValueError("Torrent metadata contains an unsafe file path")
        result.append({"index": index, "path": path, "length": storage.file_size(index)})
    return result


def make_session():
    return lt.session({
        "enable_upnp": False,
        "enable_natpmp": False,
        "enable_lsd": False,
        "enable_incoming_utp": True,
        "listen_interfaces": "0.0.0.0:0,[::]:0",
    })


def save_torrent(session, handle, path):
    handle.save_resume_data(lt.save_resume_flags_t.save_info_dict)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        for alert in session.pop_alerts():
            if isinstance(alert, lt.save_resume_data_alert):
                raw = lt.bencode(lt.write_torrent_file(alert.params))
                with open(path, "wb") as output:
                    output.write(raw)
                return
            if isinstance(alert, lt.save_resume_data_failed_alert):
                raise RuntimeError(str(alert))
        time.sleep(0.1)
    raise TimeoutError("Could not save the torrent metadata for later seeding")


def run_download(config, pending):
    session = make_session()
    params = lt.parse_magnet_uri(config["magnet"])
    params.save_path = config["staging"]
    params.flags |= lt.torrent_flags.default_dont_download
    handle = session.add_torrent(params)
    # A direct loopback peer is used by the local integration test. Production
    # requests discover peers through the magnet's trackers and DHT.
    if config.get("peer"):
        handle.connect_peer((config["peer"]["host"], config["peer"]["port"]))
    deadline = time.monotonic() + 120
    files = None
    while time.monotonic() < deadline:
        try:
            command = pending.get_nowait()
            if command.get("type") == "cancel":
                return
        except queue.Empty:
            pass
        info = handle.torrent_file()
        if info and info.is_valid():
            files = normalized_files(info)
            break
        for alert in session.pop_alerts():
            if isinstance(alert, lt.torrent_error_alert):
                raise RuntimeError(str(alert))
        time.sleep(0.2)
    if files is None:
        raise TimeoutError("Torrent metadata timed out")
    if hash_string(handle) != config["infoHash"].lower():
        raise ValueError("Torrent metadata did not match the selected source")
    emit("metadata", files=files, infoHash=hash_string(handle))
    while True:
        command = pending.get()
        if command.get("type") == "cancel":
            return
        if command.get("type") == "select":
            break
    selected = command.get("indices")
    if not isinstance(selected, list) or not selected or any(type(i) is not int or i < 0 or i >= len(files) for i in selected):
        raise ValueError("Invalid torrent file selection")
    selected = sorted(set(selected))
    handle.prioritize_files([1 if i in selected else 0 for i in range(len(files))])
    total = sum(files[i]["length"] for i in selected)
    while True:
        try:
            command = pending.get_nowait()
            if command.get("type") == "cancel":
                return
        except queue.Empty:
            pass
        status = handle.status()
        progress = handle.file_progress()
        received = sum(min(progress[i], files[i]["length"]) for i in selected)
        emit("progress", receivedBytes=received, totalBytes=total,
             bytesPerSecond=status.download_payload_rate, peers=status.num_peers)
        if all(progress[i] >= files[i]["length"] for i in selected):
            handle.pause()
            save_torrent(session, handle, config["torrentFile"])
            emit("completed")
            return
        for alert in session.pop_alerts():
            if isinstance(alert, lt.torrent_error_alert):
                raise RuntimeError(str(alert))
        time.sleep(0.4)


def run_seed(config, pending):
    session = make_session()
    params = lt.add_torrent_params()
    params.ti = lt.torrent_info(config["torrentFile"])
    params.save_path = config["staging"]
    params.flags |= lt.torrent_flags.default_dont_download
    selected = set(config["indices"])
    params.file_priorities = [1 if i in selected else 0 for i in range(params.ti.num_files())]
    # A newly added torrent checks existing pieces before it can upload them.
    # Upload mode prevents a damaged or missing file from triggering a download.
    # Clearing auto management keeps libtorrent from leaving upload mode later.
    params.flags |= lt.torrent_flags.upload_mode
    params.flags &= ~lt.torrent_flags.auto_managed
    handle = session.add_torrent(params)
    handle.resume()
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            command = pending.get_nowait()
            if command.get("type") == "cancel":
                return
        except queue.Empty:
            pass
        status = handle.status()
        if status.is_finished:
            emit("seeding")
            break
        time.sleep(0.4)
    else:
        raise TimeoutError("The selected files could not be verified for seeding")
    while True:
        try:
            command = pending.get(timeout=1)
            if command.get("type") == "cancel":
                return
        except queue.Empty:
            pass
        status = handle.status()
        emit("seedProgress", uploadedBytes=status.total_payload_upload,
             bytesPerSecond=status.upload_payload_rate, peers=status.num_peers)


def main():
    config = json.loads(sys.argv[1])
    pending = commands()
    if config["mode"] == "download":
        run_download(config, pending)
    elif config["mode"] == "seed":
        run_seed(config, pending)
    else:
        raise ValueError("Unsupported libtorrent operation")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error)[:400])
        sys.exit(1)
