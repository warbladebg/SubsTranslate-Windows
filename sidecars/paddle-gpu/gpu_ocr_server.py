"""Persistent, line-recognition-only PP-OCRv6 CUDA sidecar.

Protocol: newline-delimited JSON on stdin/stdout. Each request contains an id
and base64-encoded PNG line images. The process keeps the model resident on the
GPU so an episode pays model initialization only once.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import traceback
from pathlib import Path

import cv2
import numpy as np
import paddle
from paddleocr import TextRecognition


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / ".paddlex" / "official_models" / "PP-OCRv6_medium_rec"
INFERENCE_BATCH_SIZE = max(1, min(32, int(os.environ.get("SUBS_TRANSLATE_GPU_INFERENCE_BATCH_SIZE", "1"))))


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def decode_png(encoded: str) -> np.ndarray:
    raw = base64.b64decode(encoded, validate=True)
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode PNG line image")
    return image


def main() -> int:
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(ROOT / "models" / ".paddlex"))
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    if not paddle.device.is_compiled_with_cuda():
        raise RuntimeError("Paddle was not compiled with CUDA support")
    paddle.set_device("gpu:0")
    if not MODEL_DIR.is_dir():
        raise FileNotFoundError(f"Bundled PP-OCRv6 model is missing: {MODEL_DIR}")

    recognizer = TextRecognition(
        model_name="PP-OCRv6_medium_rec",
        model_dir=str(MODEL_DIR),
        device="gpu:0",
    )
    emit({"type": "ready", "device": paddle.device.get_device(), "model": "PP-OCRv6_medium_rec"})

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        request_id = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            images = [decode_png(value) for value in request.get("images", [])]
            if not images:
                raise ValueError("OCR request contains no line images")
            predictions = list(recognizer.predict(input=images, batch_size=min(len(images), INFERENCE_BATCH_SIZE)))
            results = []
            for prediction in predictions:
                data = prediction.json["res"]
                results.append({"text": data.get("rec_text", ""), "confidence": float(data.get("rec_score", 0))})
            emit({"id": request_id, "results": results})
        except Exception as error:  # Keep the server alive for recoverable per-cue failures.
            emit({"id": request_id, "error": str(error)})

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "fatal", "error": str(error)})
        raise SystemExit(1)
