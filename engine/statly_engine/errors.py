"""Application errors mapped to JSON-RPC error codes (contracts/README.md, docs/PROTOCOL.md)."""

from __future__ import annotations


class EngineError(Exception):
    """Base class: carries a JSON-RPC error code and a short machine-readable type."""

    code = -32000
    type_name = "EngineError"

    def __init__(self, message: str, **data):
        super().__init__(message)
        self.message = message
        self.data = data

    def to_error_data(self) -> dict:
        return {"type": self.type_name, **self.data}


class FileUnreadable(EngineError):
    """-32001: file missing, unreadable, or an unsupported format."""

    code = -32001
    type_name = "FileUnreadable"


class StaleOrUnknown(EngineError):
    """-32002: stale snapshot or unknown preview_id / dataset_id."""

    code = -32002
    type_name = "StaleOrUnknown"


class InvalidParams(EngineError):
    """-32003: params fail contract validation (data.errors lists the problems)."""

    code = -32003
    type_name = "InvalidParams"

    def __init__(self, message: str, errors: list | None = None, **data):
        super().__init__(message, errors=errors if errors is not None else [message], **data)


class IncompatibleProject(EngineError):
    """-32004: project file written by a newer schema_version than this build supports."""

    code = -32004
    type_name = "IncompatibleProject"
