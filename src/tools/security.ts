export interface BlockedCommand {
  blocked: true;
  risk: string;
}

export function inspectShellCommand(command: string): BlockedCommand | null {
  const normalized = command.toLowerCase();
  if (/(^|[\s;&|({])sudo($|[\s;&|)])/i.test(command)) {
    return { blocked: true, risk: "sudo commands require explicit user escalation." };
  }
  if (/(^|[\s;&|({])opencode($|[\s;&|)])/i.test(command)) {
    return { blocked: true, risk: "OpenCode must be invoked through the dedicated opencode tool, not bash." };
  }
  if (/\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive\s+--force|--force\s+--recursive)\b/i.test(command)) {
    return { blocked: true, risk: "Recursive force deletion is blocked. Use the recoverable del tool in a later slice." };
  }
  if (/\bdiskutil\s+(erase|erasedisk|erasevolume|partitiondisk|format)/i.test(normalized)) {
    return { blocked: true, risk: "Destructive diskutil operations are blocked." };
  }
  return null;
}
