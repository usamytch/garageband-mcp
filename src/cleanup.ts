/** Also embedded in JXA: attempt every cleanup and preserve the primary failure. */
export function withCleanup<T>(action: () => T, cleanups: Array<() => void>): T {
  let result: T | undefined;
  const errors: unknown[] = [];
  try { result = action(); } catch (error) { errors.push(error); }
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new Error(errors.map(error => error && typeof error === "object" && "message" in error ? String(error.message) : String(error)).join("; "));
  return result as T;
}
