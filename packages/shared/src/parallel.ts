import type { ParallelSessionGroup } from "./types.js";

interface ParallelSessionInput {
  id: string;
  ticketId: string;
  startedAt: string;
  finishedAt?: string | null;
  totalTokens: number;
}

/**
 * Detect overlapping sessions using a sweep-line algorithm.
 * Returns groups where 2+ sessions were running concurrently.
 */
export function detectParallelSessions(
  sessions: ParallelSessionInput[]
): ParallelSessionGroup[] {
  // Filter to sessions with both start and end times
  const bounded = sessions.filter((s) => s.startedAt && s.finishedAt);
  if (bounded.length < 2) return [];

  // Create events: +1 for start, -1 for end
  interface Event {
    time: number;
    type: "start" | "end";
    session: ParallelSessionInput;
  }

  const events: Event[] = [];
  for (const s of bounded) {
    events.push({ time: new Date(s.startedAt).getTime(), type: "start", session: s });
    events.push({ time: new Date(s.finishedAt!).getTime(), type: "end", session: s });
  }

  // Sort by time, with starts before ends at same time
  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.type === "start" ? -1 : 1;
  });

  // Sweep through events tracking active sessions
  const active = new Set<ParallelSessionInput>();
  const groups: ParallelSessionGroup[] = [];
  const seen = new Set<string>(); // avoid duplicate groups

  for (const event of events) {
    if (event.type === "start") {
      active.add(event.session);

      // Check if we now have 2+ active sessions
      if (active.size >= 2) {
        const activeSessions = [...active];
        const key = activeSessions.map((s) => s.id).sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);

          // Compute overlap window
          const overlapStart = Math.max(...activeSessions.map((s) => new Date(s.startedAt).getTime()));
          const overlapEnd = Math.min(...activeSessions.map((s) => new Date(s.finishedAt!).getTime()));

          if (overlapEnd > overlapStart) {
            groups.push({
              sessions: activeSessions.map((s) => ({ id: s.id, ticketId: s.ticketId })),
              overlapStart: new Date(overlapStart).toISOString(),
              overlapEnd: new Date(overlapEnd).toISOString(),
              overlapMinutes: Math.round((overlapEnd - overlapStart) / 60000),
              combinedTokens: activeSessions.reduce((sum, s) => sum + s.totalTokens, 0),
            });
          }
        }
      }
    } else {
      active.delete(event.session);
    }
  }

  // Sort by overlap duration descending
  groups.sort((a, b) => b.overlapMinutes - a.overlapMinutes);

  return groups;
}
