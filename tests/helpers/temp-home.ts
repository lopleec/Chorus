import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime, type ChorusRuntime } from "../../src/runtime/create-runtime.js";

export interface TempRuntime {
  home: string;
  runtime: ChorusRuntime;
  cleanup(): void;
}

export function createTempRuntime(): TempRuntime {
  const home = mkdtempSync(join(tmpdir(), "chorus-test-"));
  const runtime = createRuntime({
    ...process.env,
    CHORUS_HOME: home,
    CHORUS_PROVIDER: "mock"
  });
  return {
    home,
    runtime,
    cleanup() {
      runtime.close();
      rmSync(home, { recursive: true, force: true });
    }
  };
}
