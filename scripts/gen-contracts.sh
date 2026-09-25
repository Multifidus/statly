#!/usr/bin/env bash
# Regenerate TypeScript and Python types from contracts/*.json.
#   TS:     app/src/contracts/index.ts             (json-schema-to-typescript, MIT)
#   Python: engine/statly_engine/contracts/*.py     (datamodel-code-generator, MIT; pydantic v2)
# Generated files are committed. Never edit them by hand; edit the schemas and rerun.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
TS_OUT="$ROOT/app/src/contracts"
PY_OUT="$ROOT/engine/statly_engine/contracts"
PY="$ROOT/engine/.venv/bin/python"
[ -x "$PY" ] || PY="$ROOT/engine/.venv/Scripts/python.exe"
HEADER="Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT."

# --- TypeScript: one bundled module, types deduplicated by schema title ---
mkdir -p "$TS_OUT"
(cd "$ROOT/app" && CONTRACTS="$CONTRACTS" HEADER="$HEADER" node --input-type=module -e '
import { compile } from "json-schema-to-typescript";
import fs from "node:fs";
const dir = process.env.CONTRACTS;
const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && /^[A-Z]/.test(f)).map((f) => f.slice(0, -5)).sort();
// Synthetic root that references every contract (and every Rpc definition) so
// all types land in one file exactly once.
const rpc = JSON.parse(fs.readFileSync(`${dir}/Rpc.json`, "utf8"));
const props = {};
for (const n of names) if (n !== "Rpc") props[n] = { $ref: `${n}.json` };
for (const d of Object.keys(rpc.$defs)) props[`Rpc_${d}`] = { $ref: `Rpc.json#/$defs/${d}` };
const root = { title: "StatlyContracts", type: "object", properties: props, additionalProperties: false };
let ts = await compile(root, "StatlyContracts", {
  cwd: dir,
  bannerComment: `/* eslint-disable */\n// ${process.env.HEADER}`,
  additionalProperties: false,
  unreachableDefinitions: true,
  format: true,
});
// Drop the synthetic root interface; it is not a contract.
ts = ts.replace(/export interface StatlyContracts \{[\s\S]*?\n\}\n/, "");
fs.writeFileSync(process.env.TS_FILE ?? "src/contracts/index.ts", ts);
')

# --- Python: one module per contract (pydantic v2) in a private _gen package ---
# Modules live in contracts/_gen/ so that module names (== schema names) never
# collide with the class names re-exported from statly_engine.contracts.
# Only top-level contracts/*.json are fed in (contracts/examples/ is excluded).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$CONTRACTS"/[A-Z]*.json "$TMP"/  # PascalCase = schema; lowercase (analysis_ids.json) = data
rm -rf "$PY_OUT"
mkdir -p "$PY_OUT"
"$PY" -m datamodel_code_generator \
  --input "$TMP" \
  --input-file-type jsonschema \
  --output "$PY_OUT/_gen" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --use-title-as-name \
  --use-schema-description \
  --use-field-description \
  --disable-timestamp \
  --formatters builtin \
  --custom-file-header "# $HEADER"

{
  echo "# $HEADER"
  echo '"""Pydantic v2 models for the shared Statly contracts (see contracts/README.md)."""'
  echo
  for f in "$CONTRACTS"/[A-Z]*.json; do
    n="$(basename "$f" .json)"
    if [ "$n" = "Rpc" ]; then
      echo "from ._gen import Rpc  # noqa: F401  (Phase 1 RPC params/results, e.g. Rpc.DatasetRowsParams)"
    else
      echo "from ._gen.$n import $n  # noqa: F401"
    fi
  done
} > "$PY_OUT/__init__.py"

echo "contracts: generated $(ls "$CONTRACTS"/[A-Z]*.json | wc -l | tr -d ' ') schemas -> app/src/contracts/index.ts, engine/statly_engine/contracts/"
