import type { RichText as Runs } from "@/contracts";

/** Engine RichText runs (italic statistical symbols, sub/superscripts). */
export function RichText({ runs }: { runs: Runs | null | undefined }) {
  return (
    <>
      {(runs ?? []).map((r, i) => {
        let node: React.ReactNode = r.text;
        if (r.subscript) node = <sub>{node}</sub>;
        if (r.superscript) node = <sup>{node}</sup>;
        return r.italic ? <i key={i}>{node}</i> : <span key={i}>{node}</span>;
      })}
    </>
  );
}
