export function sessionsListPage(sessionsJson: string, total: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptly - Sessions</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">Promptly</a>
    <a href="/" class="nav-link">Sessions</a>
  </nav>
  <main class="container">
    <h1>Sessions</h1>
    <p class="muted">${total} total sessions</p>
    <div id="sessions"></div>
  </main>
  <script>
    const sessions = ${sessionsJson};
    const container = document.getElementById('sessions');
    if (sessions.length === 0) {
      container.innerHTML = '<div class="empty"><p>No sessions yet.</p><p>Run <code>promptly start TICKET-ID</code> to create your first session.</p></div>';
    } else {
      container.innerHTML = sessions.map(s => {
        const started = new Date(s.started_at).toLocaleString();
        const duration = s.finished_at
          ? formatDuration(s.started_at, s.finished_at)
          : 'In progress';
        const models = JSON.parse(s.models || '[]');
        const statusClass = s.status === 'COMPLETED' ? 'badge-green' : 'badge-yellow';
        return '<a href="/sessions/' + s.id + '" class="session-card">' +
          '<div class="session-header">' +
            '<strong>' + esc(s.ticket_id) + '</strong>' +
            '<span class="badge ' + statusClass + '">' + s.status + '</span>' +
          '</div>' +
          '<div class="session-meta">' +
            '<span>' + started + '</span>' +
            '<span>' + duration + '</span>' +
            '<span>' + s.message_count + ' messages</span>' +
            '<span>' + s.total_tokens.toLocaleString() + ' tokens</span>' +
            (models.length ? '<span>' + models.join(', ') + '</span>' : '') +
          '</div>' +
        '</a>';
      }).join('');
    }
    function formatDuration(start, end) {
      const ms = new Date(end) - new Date(start);
      const min = Math.floor(ms / 60000);
      if (min < 60) return min + 'm';
      return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function sessionDetailPage(sessionJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptly - Session Detail</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">Promptly</a>
    <a href="/" class="nav-link">Sessions</a>
  </nav>
  <main class="container">
    <a href="/" class="back-link">&larr; Back to sessions</a>
    <div id="detail"></div>
  </main>
  <script>
    const s = ${sessionJson};
    const conversations = JSON.parse(s.conversations || '[]');
    const models = JSON.parse(s.models || '[]');
    const tags = JSON.parse(s.tags || '[]');
    const duration = s.finished_at
      ? Math.floor((new Date(s.finished_at) - new Date(s.started_at)) / 60000)
      : null;

    const detail = document.getElementById('detail');
    detail.innerHTML =
      '<div class="detail-header">' +
        '<h1>' + esc(s.ticket_id) + '</h1>' +
        '<span class="badge ' + (s.status === 'COMPLETED' ? 'badge-green' : 'badge-yellow') + '">' + s.status + '</span>' +
      '</div>' +
      '<div class="stats-grid">' +
        stat('Duration', duration !== null ? duration + 'm' : 'In progress') +
        stat('Messages', s.message_count) +
        stat('Total Tokens', s.total_tokens.toLocaleString()) +
        stat('Prompt Tokens', s.prompt_tokens.toLocaleString()) +
        stat('Response Tokens', s.response_tokens.toLocaleString()) +
        stat('Tool Calls', s.tool_call_count) +
      '</div>' +
      '<h2>Conversation</h2>' +
      (conversations.length === 0
        ? '<p class="muted">No conversation data recorded.</p>'
        : conversations.map(turn => {
            const roleClass = 'turn-' + turn.role;
            const time = new Date(turn.timestamp).toLocaleTimeString();
            const meta = [time, turn.model, turn.tokenCount ? turn.tokenCount + ' tokens' : ''].filter(Boolean).join(' | ');
            let toolHtml = '';
            if (turn.toolCalls && turn.toolCalls.length) {
              toolHtml = '<details class="tool-details"><summary>' + turn.toolCalls.length + ' tool call(s)</summary>' +
                turn.toolCalls.map(tc => '<pre class="tool-pre">' + esc(tc.name) + ': ' + esc(JSON.stringify(tc.input, null, 2)) + '</pre>').join('') +
                '</details>';
            }
            return '<div class="turn ' + roleClass + '">' +
              '<div class="turn-header"><span class="turn-role">' + turn.role.toUpperCase() + '</span><span class="muted">' + meta + '</span></div>' +
              '<pre class="turn-content">' + esc(turn.content) + '</pre>' +
              toolHtml +
            '</div>';
          }).join(''));

    function stat(label, value) {
      return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div>';
    }
    function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

function baseStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #ededed; }
    .nav { padding: 16px 24px; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 24px; }
    .nav-brand { color: #ededed; text-decoration: none; font-weight: 700; font-size: 18px; }
    .nav-link { color: #888; text-decoration: none; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { margin-bottom: 8px; }
    h2 { margin: 24px 0 16px; }
    .muted { color: #888; margin-bottom: 24px; }
    .back-link { color: #888; text-decoration: none; font-size: 14px; }
    .badge { font-size: 12px; padding: 2px 8px; border-radius: 4px; }
    .badge-green { background: #1a3a1a; color: #4ade80; }
    .badge-yellow { background: #3a3a1a; color: #facc15; }
    .empty { padding: 40px; text-align: center; color: #666; border: 1px dashed #333; border-radius: 8px; }
    .empty code { background: #222; padding: 2px 6px; border-radius: 4px; }
    .session-card { display: block; padding: 16px; border: 1px solid #222; border-radius: 8px; text-decoration: none; color: #ededed; margin-bottom: 8px; transition: border-color 0.15s; }
    .session-card:hover { border-color: #444; }
    .session-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .session-meta { display: flex; gap: 24px; font-size: 13px; color: #888; flex-wrap: wrap; }
    .detail-header { display: flex; align-items: center; gap: 16px; margin-top: 16px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 24px 0; padding: 16px; background: #111; border-radius: 8px; }
    .stat-label { font-size: 12px; color: #888; }
    .stat-value { font-size: 20px; font-weight: 600; }
    .turn { padding: 16px; border-radius: 8px; margin-bottom: 8px; }
    .turn-user { background: #1a1a2e; border-left: 3px solid #6366f1; }
    .turn-assistant { background: #1a2e1a; border-left: 3px solid #4ade80; }
    .turn-system { background: #2e2a1a; border-left: 3px solid #facc15; }
    .turn-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #888; }
    .turn-role { font-weight: 600; text-transform: uppercase; }
    .turn-content { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.5; font-family: inherit; }
    .tool-details { margin-top: 8px; }
    .tool-details summary { cursor: pointer; font-size: 12px; color: #888; }
    .tool-pre { margin: 4px 0; padding: 8px; background: #0a0a0a; border-radius: 4px; font-size: 12px; overflow: auto; }
  `;
}
