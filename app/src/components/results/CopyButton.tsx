import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CopyPayload } from "@/lib/apa";
import { copyRich } from "@/lib/clipboard";
import { useNotify } from "@/stores/notify";

/** Copies rich HTML + plain text (pastes into Word with italics and table rules intact). */
export function CopyButton({ payload, label, testId }: { payload: () => CopyPayload; label: string; testId?: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    try {
      await copyRich(payload());
      setDone(true);
      useNotify.getState().show("Copied. Paste it into your document.");
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      useNotify.getState().show("Statly couldn't copy to the clipboard. Select the text and copy it instead.", "error");
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void onClick()} data-testid={testId}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />} {done ? "Copied" : label}
    </Button>
  );
}
