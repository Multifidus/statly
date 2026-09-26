import { Layers } from "lucide-react";
import type { TestLogEntry } from "@/contracts";
import { Badge } from "@/components/ui/form";
import { fmtPExpr } from "@/lib/apa";
import { adjustedLabel } from "@/lib/testFamilies";
import { useProjectStore } from "@/stores/project";

/** "Part of family X, Holm-adjusted p = .052" for a Test Log entry in a family (SPEC §9). */
export function FamilyBadge({ entry }: { entry: TestLogEntry }) {
  const family = useProjectStore((s) => s.project?.test_families.find((f) => f.id === entry.family_id) ?? null);
  if (!family) return null;
  const label = adjustedLabel(entry.correction_method);
  return (
    <Badge tone="info" data-testid="family-badge" className="w-fit text-sm">
      <Layers className="size-3.5" aria-hidden />
      <span>
        Part of family “{family.name}”
        {label && entry.adjusted_p !== null ? (
          <>
            , {label} <i>p</i> {fmtPExpr(entry.adjusted_p)}
          </>
        ) : (
          ", no correction chosen yet"
        )}
      </span>
    </Badge>
  );
}
