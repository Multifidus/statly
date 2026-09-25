#!/usr/bin/env python3
"""Validate Learn library content (SPEC section 11.3). Stdlib only.

Checks, per content/learn/<category>/<id>.md:
  - front matter has the required keys, in the right category
  - body sections present, in the right order, with the right headings
  - every {{term}} marker has a matching key in content/glossary.yaml
  - a rough Flesch-Kincaid grade level (syllable-heuristic estimate)

Usage: python3 content/check_content.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEARN_DIR = ROOT / "learn"
GLOSSARY_PATH = ROOT / "glossary.yaml"
ANALYSIS_IDS_PATH = ROOT.parent / "contracts" / "analysis_ids.json"

REQUIRED_KEYS = [
    "id",
    "title",
    "category",
    "summary",
    "related",
    "reading_level_target",
    "owner_reviewed",
]

SECTIONS_BY_CATEGORY = {
    "tests": [
        "What it is",
        "When to use it",
        "An everyday analogy",
        "A worked example",
        "How to read the output",
        "How to report it (APA 7)",
        "Common mistakes",
    ],
    "assumptions": [
        "What it is",
        "When to use it",
        "An everyday analogy",
        "A worked example",
        "How to read the output",
        "What Statly checks",
        "What to do if it fails",
        "Common mistakes",
    ],
    "effect_sizes": [
        "What it is",
        "When to use it",
        "An everyday analogy",
        "A worked example",
        "How to read the output",
        "How to report it (APA 7)",
        "Benchmarks (and why to be careful)",
        "Common mistakes",
    ],
    "posthoc": [
        "What it is",
        "When to use it",
        "An everyday analogy",
        "A worked example",
        "How to read the output",
        "How to report it (APA 7)",
        "Common mistakes",
    ],
}

GRADE_TARGET = 10.5


# ---------------------------------------------------------------------------
# Tiny stdlib-only YAML-ish parsers, tailored to the fixed shapes we write.
# ---------------------------------------------------------------------------

def parse_front_matter(text):
    """Parse the '---' delimited front matter block into a dict of raw strings
    (scalars) and lists (for simple flow-style [a, b] or block '- x' lists)."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not m:
        return None, text
    fm_text, body = m.group(1), m.group(2)
    data = {}
    lines = fm_text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        km = re.match(r"^(\w+):\s*(.*)$", line)
        if not km:
            i += 1
            continue
        key, val = km.group(1), km.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            data[key] = [v.strip() for v in inner.split(",") if v.strip()] if inner else []
            i += 1
        elif val == "" and i + 1 < len(lines) and lines[i + 1].strip().startswith("- "):
            items = []
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("- "):
                items.append(lines[j].strip()[2:].strip())
                j += 1
            data[key] = items
            i = j
        else:
            data[key] = val.strip('"').strip("'")
            i += 1
    return data, body


def load_canonical_analysis_ids():
    """Flatten contracts/analysis_ids.json (family -> [ids]) into a set of
    every canonical analysis id."""
    data = json.loads(ANALYSIS_IDS_PATH.read_text(encoding="utf-8"))
    ids = set()
    for key, value in data.items():
        if key.startswith("$"):
            continue
        ids.update(value)
    return ids


def id_to_filename_stem(analysis_id):
    """tests/*.md file naming convention (see content/learn/README.md):
    the dot in a dotted canonical id (family.variant) becomes a double
    underscore in the filename; ids without a dot are unaffected."""
    return analysis_id.replace(".", "__")


def filename_stem_to_id(stem):
    """Inverse of id_to_filename_stem, for the tests/*.md category only."""
    return stem.replace("__", ".")


def parse_glossary(text):
    """Parse content/glossary.yaml: top-level term_key, nested term/short/long/
    see_also. Returns {term_key: {...}}."""
    entries = {}
    current_key = None
    current_field = None
    for raw_line in text.split("\n"):
        if not raw_line.strip() or raw_line.strip().startswith("#"):
            continue
        top_match = re.match(r"^(\w+):\s*$", raw_line)
        if top_match:
            current_key = top_match.group(1)
            entries[current_key] = {}
            current_field = None
            continue
        field_match = re.match(r"^  (\w+):\s*(.*)$", raw_line)
        if field_match and current_key:
            field, val = field_match.group(1), field_match.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                inner = val[1:-1].strip()
                entries[current_key][field] = (
                    [v.strip() for v in inner.split(",") if v.strip()] if inner else []
                )
            else:
                entries[current_key][field] = val.strip('"').strip("'")
            current_field = field
    return entries


# ---------------------------------------------------------------------------
# Flesch-Kincaid grade level via a syllable-count heuristic
# ---------------------------------------------------------------------------

def count_syllables(word):
    word = word.lower().strip(".,!?;:\"'()")
    if not word:
        return 0
    word = re.sub(r"[^a-z]", "", word)
    if not word:
        return 0
    vowels = "aeiouy"
    syllables = 0
    prev_was_vowel = False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_was_vowel:
            syllables += 1
        prev_was_vowel = is_vowel
    if word.endswith("e") and not word.endswith("le") and syllables > 1:
        syllables -= 1
    return max(syllables, 1)


def strip_markup(body):
    text = re.sub(r"\{\{[^}]+\}\}", "", body)  # drop glossary markers (not real words)
    text = re.sub(r"`[^`]*`", "", text)
    text = re.sub(r"^#{1,6}\s*.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\|", " ", text)  # tables
    text = re.sub(r"[*_]", "", text)
    return text


def flesch_kincaid_grade(body):
    text = strip_markup(body)
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    words = re.findall(r"[A-Za-z']+", text)
    if not sentences or not words:
        return 0.0
    syllables = sum(count_syllables(w) for w in words)
    n_sentences = len(sentences)
    n_words = len(words)
    grade = 0.39 * (n_words / n_sentences) + 11.8 * (syllables / n_words) - 15.59
    return round(grade, 1)


# ---------------------------------------------------------------------------
# Main validation
# ---------------------------------------------------------------------------

def main():
    glossary_text = GLOSSARY_PATH.read_text(encoding="utf-8")
    glossary = parse_glossary(glossary_text)
    canonical_analysis_ids = load_canonical_analysis_ids()

    failures = []
    grade_flags = []
    results = []

    md_files = sorted(LEARN_DIR.glob("*/*.md"))
    if not md_files:
        print("No content files found under content/learn/**/*.md")
        return 1

    for path in md_files:
        rel = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        fm, body = parse_front_matter(text)
        page_errors = []

        if fm is None:
            failures.append(f"{rel}: missing/malformed front matter")
            continue

        for key in REQUIRED_KEYS:
            if key not in fm:
                page_errors.append(f"missing front matter key '{key}'")

        dir_category = path.parent.name
        if fm.get("category") != dir_category:
            page_errors.append(
                f"category '{fm.get('category')}' does not match directory '{dir_category}'"
            )

        if fm.get("id"):
            # tests/*.md and posthoc/*.md ids are canonical analysis ids and
            # may be dotted (family.variant); the filename uses a double
            # underscore in place of the dot (see content/learn/README.md).
            # Other categories' ids are never dotted, so filename == id
            # exactly. (id_to_filename_stem is a no-op for ids without a
            # dot, so this is also safe for posthoc's non-canonical
            # multiple_comparisons page.)
            expected_stem = (
                id_to_filename_stem(fm["id"]) if dir_category in ("tests", "posthoc") else fm["id"]
            )
            if expected_stem != path.stem:
                page_errors.append(f"id '{fm.get('id')}' does not match filename '{path.stem}'")

        if dir_category == "tests" and fm.get("id"):
            if fm["id"] not in canonical_analysis_ids:
                page_errors.append(
                    f"id '{fm['id']}' is not a canonical analysis id in {ANALYSIS_IDS_PATH}"
                )

        if dir_category == "posthoc" and fm.get("id") and "." in fm["id"]:
            # Dotted posthoc ids (posthoc.tukey, etc.) must be canonical.
            # Non-dotted ids (e.g. the general multiple_comparisons page)
            # aren't analysis ids and are exempt.
            if fm["id"] not in canonical_analysis_ids:
                page_errors.append(
                    f"id '{fm['id']}' is not a canonical analysis id in {ANALYSIS_IDS_PATH}"
                )

        expected_sections = SECTIONS_BY_CATEGORY.get(dir_category)
        if expected_sections is None:
            page_errors.append(f"unknown category directory '{dir_category}'")
        else:
            found_headings = re.findall(r"^##\s+(.*?)\s*$", body, re.MULTILINE)
            if found_headings != expected_sections:
                page_errors.append(
                    "section headings/order mismatch:\n"
                    f"    expected: {expected_sections}\n"
                    f"    found:    {found_headings}"
                )

        terms_used = set(re.findall(r"\{\{([^}]+)\}\}", body))
        missing_terms = sorted(t for t in terms_used if t not in glossary)
        if missing_terms:
            page_errors.append(f"undefined glossary terms: {missing_terms}")

        grade = flesch_kincaid_grade(body)
        results.append((str(rel), grade))
        if grade > GRADE_TARGET:
            grade_flags.append((str(rel), grade))

        if page_errors:
            failures.append(f"{rel}:\n  - " + "\n  - ".join(page_errors))

    print(f"Checked {len(md_files)} pages against glossary of {len(glossary)} terms.\n")

    print("Reading grade estimates (Flesch-Kincaid, syllable heuristic):")
    for rel, grade in results:
        flag = "  <-- above target" if grade > GRADE_TARGET else ""
        print(f"  {grade:5.1f}  {rel}{flag}")

    print()
    if grade_flags:
        print(f"{len(grade_flags)} page(s) above target grade {GRADE_TARGET}:")
        for rel, grade in grade_flags:
            print(f"  - {rel} (grade {grade})")
    else:
        print(f"All pages at or under target grade {GRADE_TARGET}.")

    print()
    if failures:
        print(f"FAIL: {len(failures)} page(s) with structural/content errors:\n")
        for f in failures:
            print(f)
        return 1

    print("PASS: all pages have valid front matter, section structure, and glossary terms.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
