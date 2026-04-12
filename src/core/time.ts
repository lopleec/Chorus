export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromNow(days: number): string {
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export function isExpired(iso: string | null | undefined, at = new Date()): boolean {
  return Boolean(iso && new Date(iso).getTime() <= at.getTime());
}
