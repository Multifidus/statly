"""JSON-RPC 2.0 server loop over stdin/stdout (NDJSON), per docs/PROTOCOL.md.

Contract highlights (see docs/PROTOCOL.md for the authoritative spec):
- One JSON object per line, UTF-8, newline terminated, on stdin/stdout.
- stdout carries ONLY protocol frames; everything else (warnings, library
  chatter, logging) must go to stderr.
- Engine reads stdin until EOF, then exits 0.
- `shutdown` responds then exits 0.
- Unknown method -> error -32601. Malformed JSON line -> error -32700,
  id: null. Uncaught handler exception -> error -32000 with a `data`
  payload carrying the exception type and traceback.
"""

from __future__ import annotations

import sys
import warnings

# --- stdout/stderr discipline -------------------------------------------
# Anything imported below (numpy/pandas/scipy/statsmodels and friends) may
# print startup chatter or emit warnings. Protocol requires stdout to carry
# ONLY JSON-RPC frames, so we redirect stdout to stderr for the duration of
# these imports, then restore a freshly-configured real stdout afterward.

_real_stdout = sys.stdout
sys.stdout = sys.stderr


def _warn_to_stderr(message, category, filename, lineno, file=None, line=None):
    sys.stderr.write(
        warnings.formatwarning(message, category, filename, lineno, line)
    )


warnings.showwarning = _warn_to_stderr
warnings.simplefilter("default")

import json  # noqa: E402
import platform  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402

import numpy  # noqa: E402
import pandas  # noqa: E402
import scipy  # noqa: E402
import statsmodels  # noqa: E402

# Restore stdout for protocol frames only, and force UTF-8 line-buffered mode
# (Windows/PyInstaller may otherwise pick a non-UTF-8 or block-buffered mode).
sys.stdout = _real_stdout
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

ENGINE_VERSION = "0.1.0"

# JSON-RPC 2.0 error codes
PARSE_ERROR = -32700
METHOD_NOT_FOUND = -32601
SERVER_ERROR = -32000


def _library_versions() -> dict:
    return {
        "numpy": numpy.__version__,
        "pandas": pandas.__version__,
        "scipy": scipy.__version__,
        "statsmodels": statsmodels.__version__,
    }


def handle_ping(params: dict) -> dict:
    return {
        "pong": True,
        "engine_version": ENGINE_VERSION,
        "python_version": platform.python_version(),
        "platform": platform.platform(),
    }


def handle_engine_info(params: dict) -> dict:
    return {
        "engine_version": ENGINE_VERSION,
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "libraries": _library_versions(),
    }


def handle_shutdown(params: dict) -> dict:
    return {"ok": True}


# Handlers are pure functions of params: (dict) -> dict (JSON-serializable).
HANDLERS = {
    "ping": handle_ping,
    "engine.info": handle_engine_info,
    "shutdown": handle_shutdown,
}


def _write_frame(stdout, frame: dict) -> None:
    stdout.write(json.dumps(frame) + "\n")
    stdout.flush()


def _write_result(stdout, req_id, result: dict) -> None:
    _write_frame(stdout, {"jsonrpc": "2.0", "id": req_id, "result": result})


def _write_error(stdout, req_id, code: int, message: str, data: dict | None = None) -> None:
    error: dict = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    _write_frame(stdout, {"jsonrpc": "2.0", "id": req_id, "error": error})


def _exception_data(exc: Exception) -> dict:
    return {
        "type": type(exc).__name__,
        "traceback": traceback.format_exc(),
    }


def _log_request(method, req_id, status: str, elapsed_ms: float) -> None:
    sys.stderr.write(
        f"[engine] {method} id={req_id} {status} {elapsed_ms:.1f}ms\n"
    )
    sys.stderr.flush()


def serve(stdin=None, stdout=None) -> int:
    """Run the JSON-RPC loop until EOF or `shutdown`. Returns the exit code."""
    stdin = stdin if stdin is not None else sys.stdin
    stdout = stdout if stdout is not None else sys.stdout

    for raw_line in stdin:
        # Handle Windows CRLF input lines defensively even though Python's
        # text-mode universal-newline handling already normalizes \r\n.
        line = raw_line.rstrip("\r\n").strip()
        if not line:
            continue

        start = time.monotonic()

        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            _write_error(stdout, None, PARSE_ERROR, "Parse error", _exception_data(exc))
            _log_request(None, None, f"error -{-PARSE_ERROR}", (time.monotonic() - start) * 1000)
            continue

        if not isinstance(msg, dict):
            _write_error(
                stdout,
                None,
                PARSE_ERROR,
                "Parse error",
                {"type": "TypeError", "traceback": "Top-level JSON value must be an object"},
            )
            _log_request(None, None, f"error -{-PARSE_ERROR}", (time.monotonic() - start) * 1000)
            continue

        is_notification = "id" not in msg
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}

        handler = HANDLERS.get(method)
        if handler is None:
            if is_notification:
                continue
            _write_error(stdout, req_id, METHOD_NOT_FOUND, "Method not found")
            _log_request(method, req_id, f"error -{-METHOD_NOT_FOUND}", (time.monotonic() - start) * 1000)
            continue

        try:
            result = handler(params)
        except Exception as exc:  # noqa: BLE001 - must report any handler failure
            if is_notification:
                continue
            _write_error(stdout, req_id, SERVER_ERROR, "Server error", _exception_data(exc))
            _log_request(method, req_id, f"error -{-SERVER_ERROR}", (time.monotonic() - start) * 1000)
            continue

        if not is_notification:
            _write_result(stdout, req_id, result)
            _log_request(method, req_id, "ok", (time.monotonic() - start) * 1000)

        if method == "shutdown":
            return 0

    return 0
