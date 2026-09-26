import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { Markdown } from "@/components/learn/Markdown";
import { getLearnPage, LEARN_PAGES, learnPageFor, type LearnCategory } from "@/lib/content/learn";
import { useLearn } from "@/stores/learn";
import { useNav } from "@/stores/nav";

const CATEGORY_TITLES: Record<string, string> = {
  tests: "Tests",
  assumptions: "Assumptions",
  effect_sizes: "Effect sizes",
  posthoc: "Follow-up (post hoc) tests",
};
const categoryTitle = (c: LearnCategory) => CATEGORY_TITLES[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");
const CATEGORIES: LearnCategory[] = [...new Set([...Object.keys(CATEGORY_TITLES), ...LEARN_PAGES.map((p) => p.category)])];

/** Learn library (SPEC §11.3): every test, assumption and effect-size page, bundled offline. */
export function LearnScreen() {
  const pageId = useLearn((s) => s.pageId);
  const setPage = useLearn((s) => s.setPage);
  const prev = useNav((s) => s.prev);
  const back = useNav((s) => s.back);
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const page = learnPageFor(pageId);

  useEffect(() => {
    heading.current?.focus();
  }, [pageId]);

  const q = query.trim().toLowerCase();
  const matches = LEARN_PAGES.filter((p) => !q || p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="learn-screen">
      <div className="flex flex-wrap items-center gap-2">
        {prev && prev !== "learn" && (
          <Button variant="ghost" size="sm" onClick={back}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        )}
        {page && (
          <Button variant="ghost" size="sm" onClick={() => setPage(null)}>
            <BookOpen aria-hidden /> All topics
          </Button>
        )}
      </div>

      {page ? (
        <article aria-labelledby="learn-title" className="grid gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{categoryTitle(page.category)}</p>
          <h1 id="learn-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {page.title}
          </h1>
          <p className="text-muted-foreground">{page.summary}</p>
          {!page.ownerReviewed && <p className="text-xs text-muted-foreground">Draft: awaiting expert review.</p>}
          <Markdown className="mt-2">{page.body}</Markdown>
          {page.related.length > 0 && (
            <nav aria-label="Related topics" className="mt-4 border-t pt-4">
              <h2 className="mb-2 text-sm font-semibold">Related</h2>
              <ul className="flex flex-wrap gap-2">
                {page.related.map((r) => {
                  const rp = getLearnPage(r);
                  return rp ? (
                    <li key={r}>
                      <Button variant="outline" size="sm" onClick={() => setPage(r)}>
                        {rp.title}
                      </Button>
                    </li>
                  ) : null;
                })}
              </ul>
            </nav>
          )}
        </article>
      ) : (
        <section aria-labelledby="learn-title" className="grid gap-4">
          <div>
            <h1 id="learn-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
              Learn
            </h1>
            <p className="text-muted-foreground">Plain-language guides to every test, assumption and effect size Statly uses.</p>
          </div>
          <label className="relative block max-w-sm">
            <span className="sr-only">Search topics</span>
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics" className="pl-8" />
          </label>
          {matches.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching topics"
              body="Nothing matches that search. Try a shorter or different word."
              action={{ label: "Clear search", onClick: () => setQuery("") }}
            />
          ) : (
            CATEGORIES.map((cat) => {
              const pages = matches.filter((p) => p.category === cat);
              if (!pages.length) return null;
              return (
                <section key={cat} aria-labelledby={`learn-cat-${cat}`}>
                  <h2 id={`learn-cat-${cat}`} className="mb-2 font-semibold">
                    {categoryTitle(cat)}
                  </h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {pages.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setPage(p.id)}
                          className="w-full rounded-md border p-3 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <span className="block text-sm font-medium">{p.title}</span>
                          <span className="block text-xs text-muted-foreground">{p.summary}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
