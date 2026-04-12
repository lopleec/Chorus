export function parseJsonObject<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function summarizeForLog(input: unknown, maxLength = 500): string {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
