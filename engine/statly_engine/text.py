"""Shared plain-language text helpers used by both data/ and stats/ (no other package deps, so
either layer can import it without creating a cycle)."""

from __future__ import annotations


def plural(n: int, singular: str, plural_form: str | None = None) -> str:
    """"{n} {noun}" with the noun in its singular form for n == 1 (English "people" -> "person",
    not "peoples"). Use everywhere a count precedes a countable noun in plain-language text."""
    word = singular if abs(n) == 1 else (plural_form or f"{singular}s")
    return f"{n} {word}"
