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

// A single git commit captured during a session
export interface GitCommit {
  hash: string; // short hash (7 chars)
  message: string; // subject line
  timestamp: string; // ISO 8601
  filesChanged: number;
  insertions: number;
  deletions: number;
}

// Session category (auto-classified at finish time)
export type SessionCategory =
  | "bug-fix" | "feature" | "refactor"
  | "investigation" | "testing" | "docs" | "other";

// Aggregated git activity during a session
export interface GitActivity {
  branch: string;
  commits: GitCommit[];
  totalCommits: number;
  totalInsertions: number;
  totalDeletions: number;
  totalFilesChanged: number;
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
  intelligence?: SessionIntelligence;
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
  gitActivity?: GitActivity;
  category?: SessionCategory;
  intelligence?: SessionIntelligence;
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
  gitActivity?: GitActivity;
  category?: SessionCategory;
  intelligence?: SessionIntelligence;
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

// Session quality score (computed at finish time)
export interface SessionQualityScore {
  overall: number;          // 1-5
  planModeUsed: boolean;
  correctionRate: number;   // 0-1
  oneShotSuccess: boolean;  // ≤2 follow-up user messages
  errorRecovery: number;    // 0-1 (1=clean, 0.7=errors resolved, 0.3=unresolved)
  turnsToComplete: number;
}

// Tool usage statistics (computed at finish time)
export interface ToolUsageStats {
  toolCounts: Record<string, number>;  // { "Bash": 15, "Read": 8 }
  skillInvocations: string[];          // ["/commit", "/review-pr"]
  totalToolCalls: number;
  topTools: { name: string; count: number }[];
}

// Subagent statistics (computed at finish time)
export interface SubagentStats {
  totalSpawned: number;
  subagentTypes: Record<string, number>;  // { "Explore": 2, "Plan": 1 }
  topTypes: { type: string; count: number }[];
}

// Combined session intelligence (stored as JSON)
export interface SessionIntelligence {
  qualityScore: SessionQualityScore;
  toolUsage: ToolUsageStats;
  subagentStats: SubagentStats;
}

// Weekly digest types

export interface DigestSessionInput {
  ticketId: string;
  startedAt: string;
  finishedAt?: string | null;
  status: string;
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  messageCount: number;
  models: string[];
  category?: string | null;
  gitActivity?: {
    totalCommits: number;
    totalInsertions: number;
    totalDeletions: number;
  } | null;
  intelligence?: {
    qualityScore?: { overall: number };
  } | null;
  userName?: string | null;
  userEmail?: string;
  costEstimate?: number;
}

export interface DigestPeriodMetrics {
  totalSessions: number;
  completedSessions: number;
  totalTokens: number;
  totalMessages: number;
  totalCost: number;
  avgDuration: number;
  avgQuality: number | null;
  totalCommits: number;
  totalInsertions: number;
  totalDeletions: number;
}

export interface DigestComparison {
  current: DigestPeriodMetrics;
  previous: DigestPeriodMetrics;
  changes: {
    sessions: number | null;
    tokens: number | null;
    cost: number | null;
    messages: number | null;
    quality: number | null;
    commits: number | null;
  };
}

export interface DigestTopProject {
  project: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface DigestDeveloperEfficiency {
  name: string;
  sessions: number;
  tokensPerSession: number;
  costPerSession: number;
  avgQuality: number | null;
}

export interface WeeklyDigest {
  periodLabel: string;
  previousLabel: string;
  comparison: DigestComparison;
  topProjects: DigestTopProject[];
  developers: DigestDeveloperEfficiency[];
  topCategories: { category: string; sessions: number; tokens: number }[];
  highlights: string[];
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
