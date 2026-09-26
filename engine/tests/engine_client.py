"""Subprocess JSON-RPC client for `python -m statly_engine` (docs/PROTOCOL.md).

STATLY_ENGINE_BIN=<path to packaged statly-engine> runs the same RPC tests against the PyInstaller
bundle instead; STATLY_RPC_TRACE=<file> appends "<method>\t<ok|error>" per response.
"""

from __future__ import annotations

import itertools
import json
import os
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]


class EngineClient:
    def __init__(self):
        binary = os.environ.get("STATLY_ENGINE_BIN")
        cmd = [binary] if binary else [sys.executable, "-m", "statly_engine"]
        self.proc = subprocess.Popen(
            cmd, cwd=Path(binary).parent if binary else ENGINE_DIR,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1,
        )
        self._ids = itertools.count(1)

    def request(self, method: str, params: dict | None = None) -> dict:
        req_id = next(self._ids)
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method,
                                          "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if line == "":
            raise AssertionError("engine closed stdout unexpectedly (EOF)")
        resp = json.loads(line)
        trace = os.environ.get("STATLY_RPC_TRACE")
        if trace:
            with open(trace, "a", encoding="utf-8") as fh:
                fh.write(f"{method}\t{'error' if 'error' in resp else 'ok'}\n")
        assert resp["id"] == req_id
        return resp

    def call(self, method: str, params: dict | None = None) -> dict:
        resp = self.request(method, params)
        assert "error" not in resp, resp.get("error")
        return resp["result"]

    def error(self, method: str, params: dict | None = None) -> dict:
        resp = self.request(method, params)
        assert "error" in resp, f"expected an error from {method}"
        return resp["error"]

    def close(self):
        if self.proc.poll() is None:
            try:
                self.call("shutdown")
                self.proc.wait(timeout=10)
            finally:
                if self.proc.poll() is None:
                    self.proc.kill()
                    self.proc.wait(timeout=5)
