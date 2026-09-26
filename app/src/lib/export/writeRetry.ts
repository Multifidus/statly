/**
 * A path from the save dialog can point at a file the engine won't overwrite silently
 * (`-32003`/`file_exists`, docs/PROTOCOL.md "Phase 8 methods"). The user already chose that exact
 * path in a save dialog, so retrying once with `overwrite: true` is the expected behavior rather
 * than a second confirmation; anything else about the error is rethrown as-is.
 */
export async function withOverwriteRetry<P extends { overwrite?: boolean }, R>(
  call: (p: P) => Promise<R>,
  params: P,
): Promise<R> {
  try {
    return await call({ ...params, overwrite: false });
  } catch (e) {
    if (isFileExists(e)) return call({ ...params, overwrite: true });
    throw e;
  }
}

export function isFileExists(e: unknown): boolean {
  const err = e as { kind?: string; data?: { reason?: string } } | undefined;
  return err?.kind === "rpc" && err.data?.reason === "file_exists";
}
