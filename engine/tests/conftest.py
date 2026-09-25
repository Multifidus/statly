"""Shared subprocess harness fixture (see engine_client.py)."""

from __future__ import annotations

import pytest

from engine_client import EngineClient


@pytest.fixture
def engine():
    client = EngineClient()
    try:
        yield client
    finally:
        client.close()
