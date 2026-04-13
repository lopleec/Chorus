import type { z } from "zod";

export type AgentRole = "main" | "sub" | "security_review" | "memory_classifier";
export type AgentId = string;
export type TaskId = string;
export type ToolName = string;
export type WorkspaceId = string;

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "stopped"
  | "loop_detected";

export type ToolExecutionStatus = "ok" | "error" | "blocked";
export type MemoryKind = "world_fact" | "belief" | "experience" | "summary";
export type MemoryScope = "global" | "workspace";
export type ProviderId = string;

export interface ToolResult<TData = unknown> {
  status: ToolExecutionStatus;
  summary: string;
  data?: TData;
  error?: string;
  risk?: string;
}

export interface ToolContext {
  actorId: AgentId;
  actorRole: AgentRole;
  cwd: string;
  taskId?: TaskId;
  subAgentId?: AgentId;
  allowedRoots?: string[];
  signal?: AbortSignal;
}

export interface ToolDefinition<TParams = unknown, TData = unknown> {
  name: ToolName;
  description: string;
  paramsSchema: z.ZodType<TParams>;
  execute(params: TParams, context: ToolContext): Promise<ToolResult<TData>>;
  dispose?(): Promise<void> | void;
}

export interface ToolCall<TParams = unknown> {
  name: ToolName;
  params: TParams;
}

export interface OperationRecord {
  id: string;
  at: string;
  actorId: AgentId;
  actorRole: AgentRole;
  taskId?: TaskId;
  subAgentId?: AgentId;
  toolName: ToolName;
  inputSummary: string;
  status: ToolExecutionStatus;
  summary: string;
  durationMs: number;
  risk?: string;
  error?: string;
}

export interface SubAgentBrief {
  task_id: TaskId;
  goal: string;
  success_criteria: string[];
  workspace: string;
  important_constraints: string[];
  file_scope: string[];
  agent_assignments: Record<string, string>;
  shared_decisions: Record<string, string>;
  open_questions: string[];
}

export interface SubAgentRecord {
  id: AgentId;
  taskId: TaskId;
  role: AgentRole;
  status: TaskStatus;
  brief: SubAgentBrief;
  currentAction?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxMessage {
  id: string;
  senderId: AgentId;
  recipientId: AgentId;
  taskId?: TaskId;
  type: string;
  body: string;
  createdAt: string;
  readAt?: string | null;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  workspace?: string | null;
  kind: MemoryKind;
  summary: string;
  body?: string | null;
  tags: string[];
  weight: number;
  confidence?: number | null;
  ttl_expires_at?: string | null;
  source_task_id?: string | null;
  recall_count: number;
  last_accessed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryQuery {
  keyword?: string;
  tags?: string[];
  workspace?: string;
  scope?: MemoryScope;
  topK?: number;
  includeExpired?: boolean;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  reasons: string[];
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
}

export interface ProviderResponse {
  text: string;
  raw?: unknown;
  usage?: unknown;
}

export interface ProviderStreamChunk {
  text: string;
  raw?: unknown;
  usage?: unknown;
  done?: boolean;
}

export interface TextProvider {
  id: ProviderId;
  generateText(request: ProviderRequest): Promise<ProviderResponse>;
  streamText?(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}
