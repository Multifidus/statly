import { parseApaMarkup } from "@/lib/apa";
import { RichText } from "@/components/results/RichText";

/**
 * Renders a Learn-library "How to report it (APA 7)" section: plain prose plus a backtick-quoted
 * `Template:` and a prose `Filled example:` line, both containing `*italic*` statistic symbols,
 * `_word` subscripts and superscripts. Markdown code spans don't parse nested emphasis, and plain
 * `*x*` text never renders `_word`/superscript notation, so this parses the same inline markup the
 * APA sentence uses (see `parseApaMarkup`) instead of routing the section through react-markdown.
 */
export function HowToReport({ markdown }: { markdown: string }) {
  const paragraphs = markdown.split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {paragraphs.map((p, i) => (
        <p key={i}>
          {splitCodeSpans(p).map((seg, j) =>
            seg.code ? (
              <code key={j} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
                <RichText runs={parseApaMarkup(seg.text)} />
              </code>
            ) : (
              <RichText key={j} runs={parseApaMarkup(seg.text)} />
            ),
          )}
        </p>
      ))}
    </div>
  );
}

function splitCodeSpans(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), code: false });
    out.push({ text: m[1], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), code: false });
  return out;
}
