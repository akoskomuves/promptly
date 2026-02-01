// Session status
export type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

// Review status
export type ReviewStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "APPROVED"
  | "CHANGES_REQUESTED";

// A single conversation turn (user prompt or assistant response)
export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO 8601
  model?: string;
  tokenCount?: number;
  toolCalls?: ToolCallRecord[];
}

// Record of a tool call made during a conversation
export interface ToolCallRecord {
  name: string;
  input: unknown;
  output?: unknown;
  timestamp: string;
}

// Session data as stored locally by MCP server before upload
export interface LocalSession {
  ticketId: string;
  startedAt: string;
  finishedAt?: string;
  status: SessionStatus;
  conversations: ConversationTurn[];
  models: string[];
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  messageCount: number;
  toolCallCount: number;
}

// API request to create a session
export interface CreateSessionRequest {
  ticketId: string;
  ticketUrl?: string;
}

// API request to upload session data
export interface UploadSessionRequest {
  conversations: ConversationTurn[];
  models: string[];
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  messageCount: number;
  toolCallCount: number;
  startedAt: string;
  finishedAt: string;
}

// API response for a session
export interface SessionResponse {
  id: string;
  ticketId: string;
  ticketUrl?: string;
  userId: string;
  status: SessionStatus;
  startedAt: string;
  finishedAt?: string;
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  messageCount: number;
  toolCallCount: number;
  conversations: ConversationTurn[];
  models: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// CLI config stored at ~/.promptly/config.json
export interface CliConfig {
  apiUrl: string;
  token?: string;
  userEmail?: string;
  mode?: "local" | "cloud";
}

// State file for active session ~/.promptly/session.json
export interface ActiveSessionState {
  sessionId: string;
  ticketId: string;
  startedAt: string;
  apiUrl: string;
}
