import { relative, resolve, sep } from "node:path";

export function resolveToolPath(cwd: string, target: string, allowedRoots?: string[]): string {
  const resolved = resolve(cwd, target);
  if (!allowedRoots?.length) {
    return resolved;
  }
  const allowed = allowedRoots.some((root) => {
    const normalizedRoot = resolve(root);
    const rel = relative(normalizedRoot, resolved);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
  });
  if (!allowed) {
    throw new Error(`Path is outside allowed roots: ${target}`);
  }
  return resolved;
}
