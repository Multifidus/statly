"""Contract tests: every example instance validates against its JSON Schema
(draft 2020-12, cross-file $refs resolved by $id) and round-trips through the
generated pydantic v2 model without loss."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

import statly_engine.contracts as contracts

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
EXAMPLES_DIR = CONTRACTS_DIR / "examples"
BASE = "https://statly.local/contracts/"

CONTRACT_NAMES = [
    "VariableSchema", "DatasetMeta", "ProjectFile", "AnalysisRequest", "AnalysisResult",
    "AssumptionResult", "ChartSpec", "TestLogEntry", "TagCodebook", "StudyPlan",
]


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


SCHEMAS = {p.stem: _load(p) for p in sorted(CONTRACTS_DIR.glob("*.json")) if p.stem[0].isupper()}  # PascalCase = schema; lowercase = data
REGISTRY = Registry().with_resources(
    (s["$id"], Resource.from_contents(s)) for s in SCHEMAS.values()
)


def _validator(ref: str) -> Draft202012Validator:
    return Draft202012Validator(
        {"$ref": BASE + ref}, registry=REGISTRY, format_checker=FormatChecker()
    )


def test_all_contract_schemas_present():
    assert set(CONTRACT_NAMES) <= set(SCHEMAS)


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_schema_is_valid_2020_12(name):
    schema = SCHEMAS[name]
    Draft202012Validator.check_schema(schema)
    assert schema["$id"] == f"{BASE}{name}.json"
    if name != "Rpc":
        assert schema["properties"]["schema_version"] == {"const": 1}
        assert "schema_version" in schema["required"]


@pytest.mark.parametrize("name", CONTRACT_NAMES)
def test_example_validates_and_round_trips(name):
    example = _load(EXAMPLES_DIR / f"{name}.json")
    errors = sorted(_validator(f"{name}.json").iter_errors(example), key=str)
    assert not errors, "\n".join(f"{list(e.absolute_path)}: {e.message}" for e in errors)

    model_cls = getattr(contracts, name)
    model = model_cls.model_validate(example)
    dumped = model.model_dump(mode="json", exclude_unset=True)
    assert dumped == example
    # The dumped form must itself still satisfy the schema.
    assert _validator(f"{name}.json").is_valid(dumped)


@pytest.mark.parametrize("name", CONTRACT_NAMES)
def test_unknown_field_rejected_by_schema_and_model(name):
    bad = dict(_load(EXAMPLES_DIR / f"{name}.json"), not_a_field=1)
    assert not _validator(f"{name}.json").is_valid(bad)
    with pytest.raises(Exception):
        getattr(contracts, name).model_validate(bad)


def test_rpc_rows_result_round_trips():
    payload = {
        "snapshot_id": "snap_1", "offset": 0, "total_rows": 2, "columns": ["Q1", "Q2"],
        "row_ids": [0, 1], "rows": [[1, "Agree"], [None, "Disagree"]],
    }
    assert _validator("Rpc.json#/$defs/DatasetRowsResult").is_valid(payload)
    model = contracts.Rpc.DatasetRowsResult.model_validate(payload)
    assert model.model_dump(mode="json") == payload


def test_computed_definition_discriminates_ops():
    v = _validator("VariableSchema.json#/$defs/ComputedDefinition")
    assert v.is_valid({"op": "normalized_gain", "pre": {"variable": "pre", "time_level": None},
                       "post": {"variable": "post", "time_level": None}, "max_score": 20})
    assert not v.is_valid({"op": "formula", "expr": "a+b"})
