# Learn library: content format (SPEC §11.3)

One Markdown file per topic, at `content/learn/<category>/<id>.md`.
Categories: `tests`, `assumptions`, `effect_sizes`.

## Front matter

YAML front matter, these keys, in this order:

```yaml
id: t_independent            # matches the analysis id used by the engine
title: "Independent-samples t-test"
category: tests              # tests | assumptions | effect_sizes
summary: "One sentence, plain language, what this page covers."
related: [t_paired, mann_whitney, cohens_d, normality, homogeneity_of_variance]
reading_level_target: "8-10"
owner_reviewed: false
```

- `id` must be one of the analysis ids in the SPEC (see the delegation brief / engine).
- `related` items must be ids that exist elsewhere in `content/learn/**` (any category).
- `owner_reviewed` starts `false`. The project owner flips it to `true` after review.

## Body sections

Sections are H2 (`##`), in this exact order, exact headings:

### `tests/*.md`
1. What it is
2. When to use it
3. An everyday analogy
4. A worked example
5. How to read the output
6. How to report it (APA 7)
7. Common mistakes

### `assumptions/*.md`
1. What it is
2. When to use it
3. An everyday analogy
4. A worked example
5. How to read the output
6. What Statly checks
7. What to do if it fails
8. Common mistakes

(Assumption pages replace "How to report it (APA 7)" with "What Statly checks" and
"What to do if it fails", in that order, after "How to read the output".)

### `effect_sizes/*.md`
1. What it is
2. When to use it
3. An everyday analogy
4. A worked example
5. How to read the output
6. How to report it (APA 7)
7. Benchmarks (and why to be careful)
8. Common mistakes

(Effect size pages add "Benchmarks (and why to be careful)" after the APA section,
before "Common mistakes". Always note that education effects are often judged
against field-specific norms, not just Cohen's generic labels.)

## Worked examples

Use small numbers a reader can follow by hand (roughly 4-12 data points), shown
in a table where that helps. Reuse the practice-dataset scenarios in
`fixtures/practice/README.md` as running examples so later tutorials line up:
a one-class pre/post reading survey, a 3-group (Control / Intervention A /
Intervention B) knowledge-test study, or a linked-ID pre/post gain-score study.
Scale the numbers down; don't reuse the literal fixture data.

## APA 7 section (`tests/*.md`, `effect_sizes/*.md`)

Follow SPEC §10.1: italic statistical symbols, no leading zero for values that
can't exceed 1 (*p*, *r*, alpha), *p* to three decimals, `p < .001` floor,
two-tailed by default. Give a template sentence with placeholders in braces
(e.g., `{group1 mean}`), then one filled worked example sentence.

## Tone

Friendly, plain, second person ("you"), grades 8-10 reading level. Short
sentences. No unexplained jargon: the first time a technical term appears on
a page, mark it `{{term_key}}` so the app can show the hover glossary. The
key must exist in `content/glossary.yaml`. Don't mark a term more than once
per page. No em-dashes.

## Glossary

`content/glossary.yaml`: one entry per `term_key` used anywhere in
`content/learn/**`, plus the core terms listed in the delegation brief.
Each entry: `term` (display form), `short` (<=25 words), `long` (<=80 words),
`see_also` (list of other term_keys, may be empty).

## Validation

Run `python3 content/check_content.py` from the repo root. It checks:
- front matter has all required keys, in the right category, with a
  `related` list.
- body sections are present, in the right order, with the right headings
  for the page's category.
- every `{{term}}` marker used in a page has a matching key in
  `content/glossary.yaml`.
- a rough Flesch-Kincaid grade level per page (syllable-heuristic estimate,
  not exact). Target: at or under grade ~10.5.

## Owner review checklist

Before flipping `owner_reviewed: true`, check:

- [ ] Statistically correct: nothing oversimplified to the point of being wrong.
- [ ] The worked example's arithmetic is actually correct (redo it by hand).
- [ ] The APA 7 template and filled example match SPEC §10.1 formatting exactly.
- [ ] Every jargon term on first use has a `{{term}}` marker, and the marker
      isn't overused.
- [ ] Tone: friendly, second person, no em-dashes, no unexplained jargon.
- [ ] Reads at roughly grade 8-10 (see `check_content.py` output; a technical
      page that can't get there without losing accuracy is flagged, not
      silently forced).
- [ ] `related` links make sense and point to real pages.
- [ ] Assumption pages: "What to do if it fails" gives a genuinely useful
      next step (switch test, transform data, note the limitation), not
      just "talk to a statistician."
- [ ] Effect size pages: benchmark caveat about education-specific norms is
      present and not just boilerplate.
- [ ] Flip `owner_reviewed: true` only after all of the above.
