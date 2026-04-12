import type { OperationRecord } from "../core/types.js";
import { appendJsonl } from "./jsonl.js";

export class OperationLog {
  constructor(private readonly path: string) {}

  append(record: OperationRecord): void {
    appendJsonl(this.path, record);
  }
}
