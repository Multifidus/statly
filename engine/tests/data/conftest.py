import pytest

from statly_engine.data.store import DatasetStore


@pytest.fixture
def store() -> DatasetStore:
    return DatasetStore()
