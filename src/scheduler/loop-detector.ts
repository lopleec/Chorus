import type { ToolExecutionStatus } from "../core/types.js";

export interface LoopDetectionEvent {
  actorId: string;
  signature: string;
  status: ToolExecutionStatus;
}

interface LoopState {
  signature: string;
  status: ToolExecutionStatus;
  count: number;
}

export class LoopDetector {
  private readonly states = new Map<string, LoopState>();

  constructor(private readonly threshold = 3) {}

  record(event: LoopDetectionEvent): boolean {
    const previous = this.states.get(event.actorId);
    if (previous && previous.signature === event.signature && previous.status === event.status) {
      previous.count += 1;
      return previous.count >= this.threshold;
    }
    this.states.set(event.actorId, {
      signature: event.signature,
      status: event.status,
      count: 1
    });
    return false;
  }
}
