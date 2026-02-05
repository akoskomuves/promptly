// Session status
export type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

// Team role
export type TeamRole = "OWNER" | "ADMIN" | "MEMBER";

// Invite status
export type InviteStatus = "PENDING" | "ACCEPTED" | "EXPIRED";

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
  clientTool?: string; // e.g. "claude-code", "cursor", "gemini-cli"
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
  teamId?: string;
}

// API request to upload session data
export interface UploadSessionRequest {
  conversations: ConversationTurn[];
  models: string[];
  clientTool?: string; // e.g., "claude-code", "gemini-cli", "codex-cli"
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
  teamId?: string;
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

// Team data
export interface Team {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InviteStatus;
  invitedById: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  invitedBy?: {
    id: string;
    email: string;
    name: string | null;
  };
}

// API request to create a team
export interface CreateTeamRequest {
  name: string;
  slug?: string; // auto-generated from name if not provided
}

// API request to create a team invite
export interface CreateTeamInviteRequest {
  email: string;
  role?: TeamRole;
}

// API response for team with members
export interface TeamWithMembers extends Team {
  members: TeamMember[];
}

// CLI config stored at ~/.promptly/config.json
export interface CliConfig {
  apiUrl: string;
  token?: string;
  userEmail?: string;
  mode?: "local" | "cloud";
  defaultTeamSlug?: string;
  skillHintShown?: boolean; // True after showing /track skill hint
}

// State file for active session ~/.promptly/session.json
export interface ActiveSessionState {
  sessionId: string;
  ticketId: string;
  startedAt: string;
  apiUrl: string;
}
