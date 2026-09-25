import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";
import { Term } from "@/components/learn/GlossaryTerm";
import { linkGlossaryTerms } from "@/lib/content/learn";

const components: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith("glossary:")) return <Term k={href.slice("glossary:".length)}>{children}</Term>;
    // No network in shipped code: other links render as plain text.
    return <span className="underline decoration-dotted">{children}</span>;
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-[16rem] border-collapse text-sm [&_td]:border-b [&_td]:px-3 [&_td]:py-1 [&_th]:border-b-2 [&_th]:px-3 [&_th]:py-1 [&_th]:text-left">{children}</table>
    </div>
  ),
  h2: ({ children }) => <h2 className="mt-6 mb-2 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-1 font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{children}</code>,
};

const urlTransform = (url: string) => (url.startsWith("glossary:") ? url : defaultUrlTransform(url));

/** Learn-library Markdown with `{{term}}` markers as hover-glossary popovers. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {linkGlossaryTerms(children)}
      </ReactMarkdown>
    </div>
  );
}
