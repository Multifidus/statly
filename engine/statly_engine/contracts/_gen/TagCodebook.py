# Generated from contracts/*.json by scripts/gen-contracts.sh. DO NOT EDIT.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, conint, constr


class Tag(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: str
    name: constr(min_length=1)
    color: constr(pattern=r'^#[0-9a-fA-F]{6}$')
    definition: str


class TagApplication(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    row_id: conint(ge=0)
    """
    Value of the reserved _statly_row_id column (DatasetMeta.row_id_column).
    """
    variable: str
    """
    Open-text variable the response belongs to.
    """
    tag_ids: list[str]


class TagCodebook(BaseModel):
    """
    Qualitative coding of open-ended responses. SPEC §11.1.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    tags: list[Tag]
    applications: list[TagApplication]
    """
    At most one entry per (row_id, variable).
    """
