/**
 * Tiny YAML subset parser for Statly's own content files (Learn front matter and
 * content/glossary.yaml). Supports: `key: value` maps nested by indentation, double- or
 * single-quoted strings, bare scalars (numbers, true/false/null), inline lists `[a, "b"]`,
 * and `#` comments. Anything richer (block lists, folded text) is not used by those files;
 * content/check_content.py keeps them in this shape.
 */
export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function unquote(s: string): string {
  if (s.startsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  return s.slice(1, -1).replace(/''/g, "'");
}

function splitList(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      cur += c;
      if (c === "\\" && q === '"') cur += body[++i] ?? "";
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith("[") && s.endsWith("]")) return splitList(s.slice(1, -1)).map(parseScalar);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return unquote(s);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Parse an indentation-nested map. Throws on lines it does not understand. */
export function parseYamlMap(text: string): { [k: string]: YamlValue } {
  const root: { [k: string]: YamlValue } = {};
  const stack: { indent: number; obj: { [k: string]: YamlValue } }[] = [{ indent: -1, obj: root }];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((rawLine, i) => {
    const line = stripComment(rawLine).replace(/\s+$/, "");
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line.trim());
    if (!m) throw new Error(`Unsupported YAML on line ${i + 1}: ${rawLine}`);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const [, key, value] = m;
    if (value === undefined || value === "") {
      const child: { [k: string]: YamlValue } = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = parseScalar(value);
    }
  });
  return root;
}

/** Split `---\n<yaml>\n---\n<body>` front matter. Returns empty data when absent. */
export function parseFrontMatter(text: string): { data: { [k: string]: YamlValue }; body: string } {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
  if (!m) return { data: {}, body: t };
  return { data: parseYamlMap(m[1]), body: m[2] };
}
