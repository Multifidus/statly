"""Subprocess-level tests for the JSON-RPC sidecar server.

Runs `python -m statly_engine` as a real subprocess and drives it over
stdin/stdout exactly as the Tauri app will, per docs/PROTOCOL.md.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

import pytest


@pytest.fixture
def engine_process():
    proc = subprocess.Popen(
        [sys.executable, "-m", "statly_engine"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        yield proc
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def _send(proc, obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def _send_raw(proc, line: str):
    proc.stdin.write(line)
    proc.stdin.flush()


def _recv(proc, timeout=30):
    # readline() blocks until a line is available or the pipe closes (EOF).
    line = proc.stdout.readline()
    if line == "":
        raise AssertionError("engine closed stdout unexpectedly (EOF)")
    return json.loads(line)


def test_ping(engine_process):
    _send(engine_process, {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}})
    resp = _recv(engine_process)
    assert resp["jsonrpc"] == "2.0"
    assert resp["id"] == 1
    assert "error" not in resp
    result = resp["result"]
    assert result["pong"] is True
    assert result["engine_version"] == "0.1.0"
    assert result["python_version"].startswith("3.12")
    assert isinstance(result["platform"], str) and result["platform"]

    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0


def test_engine_info(engine_process):
    _send(engine_process, {"jsonrpc": "2.0", "id": "abc", "method": "engine.info", "params": {}})
    resp = _recv(engine_process)
    assert resp["id"] == "abc"
    result = resp["result"]
    assert result["engine_version"] == "0.1.0"
    assert result["python_version"].startswith("3.12")
    assert isinstance(result["platform"], str) and result["platform"]
    libs = result["libraries"]
    for name in ("numpy", "pandas", "scipy"):
        assert name in libs
        assert isinstance(libs[name], str) and libs[name]

    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0


def test_unknown_method(engine_process):
    _send(engine_process, {"jsonrpc": "2.0", "id": 5, "method": "nope.notreal", "params": {}})
    resp = _recv(engine_process)
    assert resp["id"] == 5
    assert "result" not in resp
    assert resp["error"]["code"] == -32601

    _send(engine_process, {"jsonrpc": "2.0", "id": 6, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0


def test_malformed_json_line(engine_process):
    _send_raw(engine_process, "{not valid json at all\n")
    resp = _recv(engine_process)
    assert resp["id"] is None
    assert "result" not in resp
    assert resp["error"]["code"] == -32700
    assert "data" in resp["error"]
    assert resp["error"]["data"]["type"]
    assert resp["error"]["data"]["traceback"]

    # Engine should keep serving after a malformed line.
    _send(engine_process, {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}})
    resp2 = _recv(engine_process)
    assert resp2["result"]["pong"] is True

    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0


def test_shutdown_response_and_exit(engine_process):
    _send(engine_process, {"jsonrpc": "2.0", "id": 9, "method": "shutdown", "params": {}})
    resp = _recv(engine_process)
    assert resp["id"] == 9
    assert resp["result"] == {"ok": True}
    assert engine_process.wait(timeout=10) == 0


def test_eof_exits_zero_without_shutdown(engine_process):
    engine_process.stdin.close()
    assert engine_process.wait(timeout=10) == 0


def test_stdout_carries_only_json_frames(engine_process):
    _send(engine_process, {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}})
    _recv(engine_process)
    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "engine.info", "params": {}})
    _recv(engine_process)
    _send(engine_process, {"jsonrpc": "2.0", "id": 3, "method": "shutdown", "params": {}})
    _recv(engine_process)
    engine_process.wait(timeout=10)

    remaining = engine_process.stdout.read()
    lines = [l for l in remaining.splitlines() if l.strip()]
    for line in lines:
        json.loads(line)  # every non-empty line must be valid JSON

    stderr_output = engine_process.stderr.read()
    # Not asserting stderr is empty (warnings/logging are expected there),
    # just that it never leaks into what we already validated on stdout above.
    assert isinstance(stderr_output, str)


def test_crlf_line_terminator(engine_process):
    _send_raw(engine_process, json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}}) + "\r\n")
    resp = _recv(engine_process)
    assert resp["result"]["pong"] is True

    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0


def test_notification_no_id_is_ignored(engine_process):
    # No "id" key => notification; per protocol these are ignored (no response).
    _send(engine_process, {"jsonrpc": "2.0", "method": "ping", "params": {}})
    # Follow with a normal request; its response must be the first thing we see.
    _send(engine_process, {"jsonrpc": "2.0", "id": 42, "method": "ping", "params": {}})
    resp = _recv(engine_process)
    assert resp["id"] == 42

    _send(engine_process, {"jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": {}})
    _recv(engine_process)
    assert engine_process.wait(timeout=10) == 0
