import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { WhyItMatters } from "@/components/ui/why";
import { Term } from "@/components/learn/GlossaryTerm";
import type { AdvisorRecommendation } from "@/lib/analysisRpc";
import { caveatText, labelFor } from "@/lib/content/labels";
import { learnPageFor } from "@/lib/content/learn";
import { openLearn } from "@/stores/learn";

function Item({ id, labels }: { id: string; labels: Record<string, string> }) {
  const page = learnPageFor(id);
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      <span>{labelFor(id, labels)}</span>
      {page && (
        <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openLearn(page.id)} aria-label={`Learn about ${labelFor(id, labels)}`}>
          <BookOpen aria-hidden /> Learn
        </Button>
      )}
    </li>
  );
}

function Row({ title, ids, labels }: { title: React.ReactNode; ids: string[]; labels: Record<string, string> }) {
  if (!ids.length) return null;
  return (
    <div className="grid gap-1">
      <dt className="text-sm font-medium">{title}</dt>
      <dd>
        <ul className="grid gap-0.5 text-sm">
          {ids.map((id) => (
            <Item key={id} id={id} labels={labels} />
          ))}
        </ul>
      </dd>
    </div>
  );
}

/** The advisor's recommendation (SPEC §7.1): test, alternative, assumptions, effect size, post hoc, why. */
export function RecommendationCard({
  rec,
  labels,
  onContinue,
  busy,
}: {
  rec: AdvisorRecommendation;
  labels: Record<string, string>;
  onContinue: () => void;
  busy?: boolean;
}) {
  const primary = labelFor(rec.primary_test, labels);
  const page = learnPageFor(rec.primary_test);
  return (
    <section aria-labelledby="rec-title" className="grid gap-4 rounded-xl border border-primary/40 p-5" data-testid="recommendation">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Statly recommends</p>
        <h2 id="rec-title" tabIndex={-1} className="text-xl font-semibold outline-none" data-testid="rec-primary">
          {primary}
        </h2>
      </div>
      <WhyItMatters title="Why this test?">
        <p>{rec.why_this_test}</p>
        {page && (
          <div>
            <Button variant="outline" size="sm" onClick={() => openLearn(page.id)}>
              <BookOpen aria-hidden /> Read the {page.title} guide
            </Button>
          </div>
        )}
      </WhyItMatters>
      {rec.likert_note && (
        <Notice tone="info" data-testid="likert-note">
          <span className="font-medium">About Likert questions: </span>
          {rec.likert_note}
        </Notice>
      )}
      {rec.caveats.map((c) => (
        <Notice key={c} tone="warn" data-testid={`caveat-${c}`}>
          {caveatText(c)}
        </Notice>
      ))}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row title={<>If the assumptions don't hold (<Term k="nonparametric">nonparametric</Term> alternative)</>} ids={rec.nonparametric_alternative ? [rec.nonparametric_alternative] : []} labels={labels} />
        <Row title="Assumptions to check" ids={rec.assumptions} labels={labels} />
        <Row title={<>Report this <Term k="effect_size">effect size</Term></>} ids={rec.effect_size} labels={labels} />
        <Row title="Follow-up (post hoc) tests" ids={rec.post_hoc} labels={labels} />
      </dl>
      <div>
        <Button onClick={onContinue} disabled={busy} data-testid="rec-continue">
          Set up this analysis <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
