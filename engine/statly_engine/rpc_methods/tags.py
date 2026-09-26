"""Phase 9 RPC handlers: qualitative coding (SPEC §11.1). docs/PROTOCOL.md "Phase 9 methods".

- tags.codebook.get    {dataset_id}                                   -> {codebook}
- tags.codebook.upsert {dataset_id, tag: {id?, name, color?, definition?}} -> {codebook, tag}
- tags.codebook.delete {dataset_id, tag_id}                           -> {codebook}
- tags.apply           {dataset_id, row_id, variable, tag_ids}        -> {row_id, variable, tag_ids}
- tags.responses       {dataset_id, variable, filters?, search?, tag_filter?, context_variables?,
                        offset?, limit?}                              -> paged responses + match spans
- tags.summary         {dataset_id, variable, by?}                    -> counts/percent overall + by group
- tags.to_variables    {dataset_id, snapshot_id?, variable, tag_ids?} -> {dataset_meta, warnings, created}

Models live here (contracts/Rpc.json has no Phase 9 entries); the codebook itself is the generated
TagCodebook contract model.
"""

from __future__ import annotations


from pydantic import BaseModel, ConfigDict, Field

from statly_engine.contracts import TagCodebook
from statly_engine.contracts._gen.TagCodebook import Tag
from statly_engine.data import tags as ops
from statly_engine.data.store import DatasetStore
from statly_engine.rpc_methods import rpc_method
from statly_engine.rpc_methods.variables import DatasetEditResult

Cell = str | float | int | bool | None


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _DatasetParams(_Closed):
    dataset_id: str = Field(min_length=1)


class CodebookResult(_Closed):
    codebook: TagCodebook


class TagSpec(_Closed):
    id: str | None = None
    name: str = Field(min_length=1)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    definition: str | None = None


class UpsertParams(_DatasetParams):
    tag: TagSpec


class UpsertResult(_Closed):
    codebook: TagCodebook
    tag: Tag


class DeleteParams(_DatasetParams):
    tag_id: str


class ApplyParams(_DatasetParams):
    row_id: int = Field(ge=0)
    variable: str = Field(min_length=1)
    tag_ids: list[str]


class ApplyResult(_Closed):
    row_id: int
    variable: str
    tag_ids: list[str]


class ValueFilter(_Closed):
    variable: str = Field(min_length=1)
    values: list[Cell] = Field(min_length=1)


class ResponsesParams(_DatasetParams):
    variable: str = Field(min_length=1)
    filters: list[ValueFilter] = []
    search: str | None = None
    tag_filter: str | None = None  # "untagged" or a tag id
    context_variables: list[str] = []
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=ops.MAX_PAGE)


class ResponseItem(_Closed):
    row_id: int
    text: str
    matches: list[list[int]]  # [start, end) in UTF-16 code units
    tag_ids: list[str]
    context: dict[str, Cell]


class ResponsesResult(_Closed):
    snapshot_id: str
    variable: str
    offset: int
    total: int
    total_responses: int
    items: list[ResponseItem]


class SummaryParams(_DatasetParams):
    variable: str = Field(min_length=1)
    by: str | None = None


class TagCount(_Closed):
    tag_id: str
    count: int
    percent: float | None


class GroupCounts(_Closed):
    value: Cell
    label: str
    n_responses: int
    counts: list[TagCount]


class SummaryResult(_Closed):
    snapshot_id: str
    variable: str
    n_responses: int
    n_coded: int
    n_uncoded: int
    tags: list[Tag]
    overall: list[TagCount]
    by: str | None
    groups: list[GroupCounts]
    n_missing_group: int


class ToVariablesParams(_DatasetParams):
    snapshot_id: str | None = None
    variable: str = Field(min_length=1)
    tag_ids: list[str] | None = None


class CreatedVariable(_Closed):
    tag_id: str
    variable: str
    n_yes: int
    n_no: int
    n_missing: int
    updated: bool


class ToVariablesResult(DatasetEditResult):
    created: list[CreatedVariable]


@rpc_method(_DatasetParams, CodebookResult)
def codebook_get(store: DatasetStore, params: dict) -> dict:
    import copy

    return {"codebook": copy.deepcopy(ops.codebook(store, params["dataset_id"]))}


@rpc_method(UpsertParams, UpsertResult)
def codebook_upsert(store: DatasetStore, params: dict) -> dict:
    return ops.upsert_tag(store, params["dataset_id"], params["tag"])


@rpc_method(DeleteParams, CodebookResult)
def codebook_delete(store: DatasetStore, params: dict) -> dict:
    return ops.delete_tag(store, params["dataset_id"], params["tag_id"])


@rpc_method(ApplyParams, ApplyResult)
def apply(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params["dataset_id"], params["row_id"], params["variable"], params["tag_ids"])


@rpc_method(ResponsesParams, ResponsesResult)
def responses(store: DatasetStore, params: dict) -> dict:
    return ops.responses(store, params)


@rpc_method(SummaryParams, SummaryResult)
def summary(store: DatasetStore, params: dict) -> dict:
    return ops.summary(store, params)


@rpc_method(ToVariablesParams, ToVariablesResult)
def to_variables(store: DatasetStore, params: dict) -> dict:
    return ops.to_variables(store, params)


METHODS = {
    "tags.codebook.get": codebook_get,
    "tags.codebook.upsert": codebook_upsert,
    "tags.codebook.delete": codebook_delete,
    "tags.apply": apply,
    "tags.responses": responses,
    "tags.summary": summary,
    "tags.to_variables": to_variables,
}
