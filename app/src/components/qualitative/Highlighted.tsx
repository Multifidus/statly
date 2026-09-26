import { highlightSegments } from "@/lib/qualitative/highlight";

/** Response text with search matches marked (<mark>), line breaks kept. */
export function Highlighted({ text, spans }: { text: string; spans: readonly (readonly [number, number])[] }) {
  const segs = highlightSegments(text, spans);
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap" data-testid="response-text">
      {segs.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-black dark:bg-yellow-500/80 dark:text-black">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}
