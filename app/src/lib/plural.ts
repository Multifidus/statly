/**
 * Renders a count with the right singular/plural noun, e.g. `pluralize(1, "row")` -> "1 row",
 * `pluralize(5, "row")` -> "5 rows". Pass an irregular plural explicitly when "+s" is wrong,
 * e.g. `pluralize(n, "response")` for "response"/"responses" (regular, so the default suffices),
 * or `pluralize(n, "person", "people")`.
 */
export function pluralize(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
