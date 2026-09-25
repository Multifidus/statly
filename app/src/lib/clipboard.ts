/**
 * Rich-text clipboard (SPEC §10.3): HTML + plain text so APA output pastes into Word with
 * italics intact. In the Tauri app this uses the clipboard-manager plugin (reliable in every
 * webview); in the browser (mock mode, tests) it uses the async Clipboard API.
 */
import { isTauri } from "@tauri-apps/api/core";
import type { CopyPayload } from "@/lib/apa";

export async function copyRich({ html, text }: CopyPayload): Promise<void> {
  if (isTauri()) {
    const { writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeHtml(html, text);
    return;
  }
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip) throw new Error("Clipboard unavailable");
  if (typeof ClipboardItem !== "undefined" && typeof clip.write === "function") {
    await clip.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await clip.writeText(text);
}
