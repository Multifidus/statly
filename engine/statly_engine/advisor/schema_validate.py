"""Minimal JSON Schema (draft 2020-12) validator for the subset of keywords
used by content/decision_tree.schema.json.

We validate the decision tree at load time (SPEC §7.1: "unknown next ids,
unreachable nodes, or cycles fail loudly"), but the engine's runtime
dependency set may only grow by PyYAML for this feature, so this avoids
adding `jsonschema` as a runtime dependency (it stays a dev/test dependency
for engine/tests/advisor's belt-and-suspenders schema check). Supports:
type, const, enum, pattern, minLength, minItems, minProperties, items,
properties, additionalProperties, required, oneOf, anyOf, propertyNames.
"""

from __future__ import annotations

import re
from typing import Any


class SchemaValidationError(Exception):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def _type_ok(instance: Any, type_name: str) -> bool:
    if type_name == "object":
        return isinstance(instance, dict)
    if type_name == "array":
        return isinstance(instance, list)
    if type_name == "string":
        return isinstance(instance, str)
    if type_name == "number":
        return isinstance(instance, (int, float)) and not isinstance(instance, bool)
    if type_name == "boolean":
        return isinstance(instance, bool)
    if type_name == "null":
        return instance is None
    raise ValueError(f"Unsupported schema type: {type_name}")


def _resolve(schema: dict, root: dict) -> dict:
    if set(schema.keys()) == {"$ref"}:
        ref = schema["$ref"]
        assert ref.startswith("#/"), f"Only local $refs supported, got {ref!r}"
        node: Any = root
        for part in ref[2:].split("/"):
            node = node[part]
        return node
    return schema


def _validate(instance: Any, schema: dict, root: dict, path: str, errors: list[str]) -> None:
    schema = _resolve(schema, root)

    if "oneOf" in schema:
        matches = 0
        sub_errors: list[str] = []
        for sub in schema["oneOf"]:
            local: list[str] = []
            _validate(instance, sub, root, path, local)
            if not local:
                matches += 1
            else:
                sub_errors.extend(local)
        if matches != 1:
            errors.append(f"{path}: expected exactly one oneOf branch to match, {matches} matched ({sub_errors})")
        return

    if "anyOf" in schema:
        for sub in schema["anyOf"]:
            local: list[str] = []
            _validate(instance, sub, root, path, local)
            if not local:
                return
        errors.append(f"{path}: no anyOf branch matched")
        return

    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {instance!r}")
        return

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not one of {schema['enum']}")
        return

    type_spec = schema.get("type")
    if type_spec is not None:
        types = type_spec if isinstance(type_spec, list) else [type_spec]
        if not any(_type_ok(instance, t) for t in types):
            errors.append(f"{path}: expected type {type_spec}, got {type(instance).__name__}")
            return

    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: string shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.match(schema["pattern"], instance):
            errors.append(f"{path}: {instance!r} does not match pattern {schema['pattern']!r}")

    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: array shorter than minItems {schema['minItems']}")
        if "items" in schema:
            for i, item in enumerate(instance):
                _validate(item, schema["items"], root, f"{path}[{i}]", errors)

    if isinstance(instance, dict):
        if "minProperties" in schema and len(instance) < schema["minProperties"]:
            errors.append(f"{path}: object has fewer than minProperties {schema['minProperties']}")
        required = schema.get("required", [])
        for key in required:
            if key not in instance:
                errors.append(f"{path}: missing required property {key!r}")
        properties = schema.get("properties", {})
        if "propertyNames" in schema:
            name_schema = schema["propertyNames"]
            for key in instance:
                if "pattern" in name_schema and not re.match(name_schema["pattern"], key):
                    errors.append(f"{path}: property name {key!r} does not match pattern {name_schema['pattern']!r}")
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in properties:
                _validate(value, properties[key], root, f"{path}.{key}", errors)
            elif additional is False:
                errors.append(f"{path}: unexpected property {key!r}")
            elif isinstance(additional, dict):
                _validate(value, additional, root, f"{path}.{key}", errors)


def validate(instance: Any, schema: dict) -> None:
    """Raise SchemaValidationError with every violation found (not just the first)."""
    errors: list[str] = []
    _validate(instance, schema, schema, "$", errors)
    if errors:
        raise SchemaValidationError(errors)
