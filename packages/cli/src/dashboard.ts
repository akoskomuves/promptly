function navHtml(): string {
  return `<nav class="nav">
    <a href="/" class="nav-brand">Promptly</a>
    <a href="/" class="nav-link">Sessions</a>
    <a href="/analytics" class="nav-link">Analytics</a>
    <a href="/digest" class="nav-link">Digest</a>
  </nav>`;
}

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
  ${navHtml()}
  <main class="container">
    <h1>Sessions</h1>
    <p class="muted">${total} total sessions</p>
    <div class="filters">
      <input type="text" id="search" placeholder="Search by ticket ID, tag, or conversation..." class="search-input">
      <select id="filter-status" class="filter-select">
        <option value="">All statuses</option>
        <option value="COMPLETED">Completed</option>
        <option value="ACTIVE">Active</option>
      </select>
      <select id="filter-tool" class="filter-select">
        <option value="">All tools</option>
      </select>
      <select id="filter-category" class="filter-select">
        <option value="">All categories</option>
        <option value="bug-fix">Bug Fix</option>
        <option value="feature">Feature</option>
        <option value="refactor">Refactor</option>
        <option value="investigation">Investigation</option>
        <option value="testing">Testing</option>
        <option value="docs">Docs</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div class="export-buttons">
      <a href="/api/sessions/export.json" class="btn btn-sm">Export JSON</a>
      <a href="/api/sessions/export.csv" class="btn btn-sm">Export CSV</a>
    </div>
    <div id="charts" class="charts-row"></div>
    <p class="muted" id="result-count"></p>
    <div id="sessions"></div>
  </main>
  <script>
    const allSessions = ${sessionsJson};
    const container = document.getElementById('sessions');
    const searchInput = document.getElementById('search');
    const statusFilter = document.getElementById('filter-status');
    const toolFilter = document.getElementById('filter-tool');
    const categoryFilter = document.getElementById('filter-category');
    const resultCount = document.getElementById('result-count');

    // Populate tool filter options
    const tools = [...new Set(allSessions.map(s => s.client_tool).filter(Boolean))];
    tools.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      toolFilter.appendChild(opt);
    });

    function render() {
      const query = searchInput.value.toLowerCase();
      const status = statusFilter.value;
      const tool = toolFilter.value;
      const category = categoryFilter.value;

      const filtered = allSessions.filter(s => {
        if (status && s.status !== status) return false;
        if (tool && s.client_tool !== tool) return false;
        if (category && (s.category || '') !== category) return false;
        if (query) {
          const ticketMatch = s.ticket_id.toLowerCase().includes(query);
          const convos = JSON.parse(s.conversations || '[]');
          const convoMatch = convos.some(c => c.content.toLowerCase().includes(query));
          const modelMatch = (s.models || '').toLowerCase().includes(query);
          const tagMatch = JSON.parse(s.tags || '[]').some(t => t.toLowerCase().includes(query));
          if (!ticketMatch && !convoMatch && !modelMatch && !tagMatch) return false;
        }
        return true;
      });

      resultCount.textContent = filtered.length === allSessions.length
        ? ''
        : filtered.length + ' of ' + allSessions.length + ' sessions';

      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty"><p>No matching sessions.</p></div>';
        return;
      }

      container.innerHTML = filtered.map(s => {
        const started = new Date(s.started_at).toLocaleString();
        const duration = s.finished_at
          ? formatDuration(s.started_at, s.finished_at)
          : 'In progress';
        const models = JSON.parse(s.models || '[]');
        const sTags = JSON.parse(s.tags || '[]');
        const statusClass = s.status === 'COMPLETED' ? 'badge-green' : 'badge-yellow';
        const tagsHtml = sTags.map(t => '<span class="tag">' + esc(t) + '</span>').join('');
        const categoryHtml = s.category ? '<span class="category-badge category-' + s.category + '">' + s.category + '</span>' : '';
        var qualityHtml = '';
        if (s.intelligence) {
          try {
            var intel = JSON.parse(s.intelligence);
            if (intel.qualityScore) {
              var rating = Math.round(intel.qualityScore.overall);
              qualityHtml = '<span class="quality-stars">' + '\u2605'.repeat(rating) + '\u2606'.repeat(5 - rating) + '</span>';
            }
          } catch(e) {}
        }
        return '<a href="/sessions/' + s.id + '" class="session-card">' +
          '<div class="session-header">' +
            '<strong>' + esc(s.ticket_id) + '</strong>' +
            '<div>' + qualityHtml + categoryHtml + tagsHtml + '<span class="badge ' + statusClass + '">' + s.status + '</span></div>' +
          '</div>' +
          '<div class="session-meta">' +
            '<span>' + started + '</span>' +
            '<span>' + duration + '</span>' +
            '<span>' + s.message_count + ' messages</span>' +
            '<span>' + s.total_tokens.toLocaleString() + ' tokens</span>' +
            '<span class="cost" data-id="' + s.id + '"></span>' +
            (function() {
              try {
                var ga = s.git_activity ? JSON.parse(s.git_activity) : null;
                if (ga && ga.totalCommits > 0) return '<span class="git-badge">' + ga.totalCommits + ' commit' + (ga.totalCommits !== 1 ? 's' : '') + ', +' + ga.totalInsertions + '/-' + ga.totalDeletions + '</span>';
              } catch(e) {}
              return '';
            })() +
            (s.client_tool ? '<span>' + esc(s.client_tool) + '</span>' : '') +
            (models.length ? '<span>' + models.join(', ') + '</span>' : '') +
          '</div>' +
        '</a>';
      }).join('');
    }

    searchInput.addEventListener('input', render);
    statusFilter.addEventListener('change', render);
    toolFilter.addEventListener('change', render);
    categoryFilter.addEventListener('change', render);
    render();

    // Fetch live pricing and show estimated costs
    let pricingData = null;
    fetch('/api/pricing').then(r => r.json()).then(models => {
      pricingData = models;
      updateCosts();
    }).catch(() => {});

    function findPrice(modelName) {
      if (!pricingData || !modelName) return null;
      const lower = modelName.toLowerCase();
      if (pricingData[lower]) return pricingData[lower];
      // Partial match
      for (const [key, val] of Object.entries(pricingData)) {
        if (lower.includes(key) || key.includes(lower)) return val;
      }
      return null;
    }

    function calcCost(session) {
      const models = JSON.parse(session.models || '[]');
      if (!models.length || (!session.prompt_tokens && !session.response_tokens)) return null;
      const p = findPrice(models[0]);
      if (!p) return null;
      const cost = (session.prompt_tokens / 1e6) * p.input_price_per_million + (session.response_tokens / 1e6) * p.output_price_per_million;
      if (cost < 0.01) return '<$0.01';
      return '$' + cost.toFixed(2);
    }

    function updateCosts() {
      allSessions.forEach(s => {
        const el = document.querySelector('.cost[data-id="' + s.id + '"]');
        if (el) {
          const cost = calcCost(s);
          el.textContent = cost || '';
        }
      });
    }

    // Re-apply costs after filter re-renders
    const origRender = render;
    render = function() { origRender(); if (pricingData) updateCosts(); };

    function formatDuration(start, end) {
      const ms = new Date(end) - new Date(start);
      const min = Math.floor(ms / 60000);
      if (min < 60) return min + 'm';
      return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // Charts
    (function() {
      const chartsEl = document.getElementById('charts');
      if (allSessions.length < 2) { chartsEl.style.display = 'none'; return; }

      // Aggregate by day
      const byDay = {};
      allSessions.forEach(s => {
        const day = s.started_at.slice(0, 10);
        if (!byDay[day]) byDay[day] = { sessions: 0, tokens: 0 };
        byDay[day].sessions++;
        byDay[day].tokens += s.total_tokens;
      });

      const days = Object.keys(byDay).sort();
      // Fill gaps
      if (days.length >= 2) {
        const start = new Date(days[0]);
        const end = new Date(days[days.length - 1]);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          if (!byDay[key]) byDay[key] = { sessions: 0, tokens: 0 };
        }
      }
      const sortedDays = Object.keys(byDay).sort();
      const last30 = sortedDays.slice(-30);

      function barChart(containerId, data, label, color) {
        const max = Math.max(...data.map(d => d.value), 1);
        const w = 500, h = 160, pad = 30, barGap = 2;
        const barW = Math.max(2, (w - pad) / data.length - barGap);

        let svg = '<svg viewBox="0 0 ' + w + ' ' + (h + 20) + '" class="chart-svg">';
        // Y axis labels
        svg += '<text x="0" y="12" class="chart-label">' + max.toLocaleString() + '</text>';
        svg += '<text x="0" y="' + (h - 2) + '" class="chart-label">0</text>';
        // Bars
        data.forEach((d, i) => {
          const barH = Math.max(2, (d.value / max) * (h - 20));
          const x = pad + i * (barW + barGap);
          const y = h - barH;
          // Invisible full-height hover target
          svg += '<rect x="' + x + '" y="0" width="' + barW + '" height="' + h + '" fill="transparent" class="chart-hover" data-val="' + d.value.toLocaleString() + '" data-date="' + d.label + '"></rect>';
          // Visible bar
          svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="' + (d.value === 0 ? '#333' : color) + '" rx="1" pointer-events="none"></rect>';
        });
        // X axis labels (first, middle, last)
        if (data.length > 0) {
          const positions = [0, Math.floor(data.length / 2), data.length - 1];
          positions.forEach(i => {
            const x = pad + i * (barW + barGap) + barW / 2;
            svg += '<text x="' + x + '" y="' + (h + 14) + '" text-anchor="middle" class="chart-label">' + data[i].label.slice(5) + '</text>';
          });
        }
        svg += '</svg>';
        return '<div class="chart-card"><h3>' + label + '</h3>' + svg + '</div>';
      }

      const sessionsData = last30.map(d => ({ label: d, value: byDay[d].sessions }));
      const tokensData = last30.map(d => ({ label: d, value: byDay[d].tokens }));

      chartsEl.innerHTML =
        '<div id="chart-tooltip" class="chart-tooltip"></div>' +
        barChart('sessions-chart', sessionsData, 'Sessions per day', '#6366f1') +
        barChart('tokens-chart', tokensData, 'Tokens per day', '#4ade80');

      const tooltip = document.getElementById('chart-tooltip');
      chartsEl.addEventListener('mouseover', function(e) {
        const rect = e.target.closest('.chart-hover');
        if (!rect) { tooltip.style.display = 'none'; return; }
        tooltip.textContent = rect.dataset.date + ': ' + rect.dataset.val;
        tooltip.style.display = 'block';
      });
      chartsEl.addEventListener('mousemove', function(e) {
        tooltip.style.left = (e.pageX + 12) + 'px';
        tooltip.style.top = (e.pageY - 28) + 'px';
      });
      chartsEl.addEventListener('mouseout', function(e) {
        if (!e.target.closest('.chart-hover')) tooltip.style.display = 'none';
      });
    })();
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
  ${navHtml()}
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

    var gitActivity = null;
    try { if (s.git_activity) gitActivity = JSON.parse(s.git_activity); } catch(e) {}
    var hasGit = gitActivity && gitActivity.totalCommits > 0;

    var intelligence = null;
    try { if (s.intelligence) intelligence = JSON.parse(s.intelligence); } catch(e) {}

    const detail = document.getElementById('detail');
    detail.innerHTML =
      '<div class="detail-header">' +
        '<h1>' + esc(s.ticket_id) + '</h1>' +
        '<span class="badge ' + (s.status === 'COMPLETED' ? 'badge-green' : 'badge-yellow') + '">' + s.status + '</span>' +
        (conversations.length > 0 ? '<a href="/sessions/' + s.id + '/replay" class="btn btn-sm" style="margin-left:auto">Replay</a>' : '') +
      '</div>' +
      '<div class="stats-grid">' +
        stat('Duration', duration !== null ? duration + 'm' : 'In progress') +
        stat('Messages', s.message_count) +
        stat('Total Tokens', s.total_tokens.toLocaleString()) +
        stat('Prompt Tokens', s.prompt_tokens.toLocaleString()) +
        stat('Response Tokens', s.response_tokens.toLocaleString()) +
        stat('Tool Calls', s.tool_call_count) +
        '<div class="stat" id="cost-stat" style="display:none"><div class="stat-label">Est. Cost</div><div class="stat-value" id="cost-value"></div></div>' +
        (s.category ? stat('Category', '<span class="category-badge category-' + s.category + '">' + s.category + '</span>') : '') +
        (s.client_tool ? stat('AI Tool', s.client_tool) : '') +
        (hasGit ? stat('Commits', gitActivity.totalCommits) : '') +
        (hasGit ? stat('Lines Changed', '+' + gitActivity.totalInsertions + ' / -' + gitActivity.totalDeletions) : '') +
        (hasGit ? stat('Branch', gitActivity.branch) : '') +
      '</div>' +
      '<div class="tags-section">' +
        '<h2>Tags</h2>' +
        '<div id="tags-container" class="tags-container"></div>' +
        '<div class="tag-input-row">' +
          '<input type="text" id="tag-input" placeholder="Add tag..." class="search-input" style="flex:1;max-width:200px;">' +
          '<button id="tag-add" class="btn btn-sm">Add</button>' +
        '</div>' +
      '</div>' +
      (intelligence ?
        '<h2>Session Intelligence</h2>' +
        '<div class="intel-grid">' +
          // Quality Score Card
          '<div class="intel-card">' +
            '<h3>Quality Score</h3>' +
            '<div class="quality-rating">' +
              '<span class="quality-stars-lg">' + (function() {
                var r = Math.round(intelligence.qualityScore.overall);
                return '\u2605'.repeat(r) + '\u2606'.repeat(5 - r);
              })() + '</span>' +
              '<span class="quality-number">' + intelligence.qualityScore.overall + '/5</span>' +
            '</div>' +
            '<div class="intel-details">' +
              '<div class="intel-row"><span>Plan Mode</span><span>' + (intelligence.qualityScore.planModeUsed ? 'Yes' : 'No') + '</span></div>' +
              '<div class="intel-row"><span>One-shot</span><span>' + (intelligence.qualityScore.oneShotSuccess ? 'Yes' : 'No') + '</span></div>' +
              '<div class="intel-row"><span>Correction Rate</span><span>' + Math.round(intelligence.qualityScore.correctionRate * 100) + '%</span></div>' +
              '<div class="intel-row"><span>Error Recovery</span><span>' + (intelligence.qualityScore.errorRecovery === 1 ? 'Clean' : intelligence.qualityScore.errorRecovery >= 0.7 ? 'Resolved' : 'Unresolved') + '</span></div>' +
              '<div class="intel-row"><span>Turns</span><span>' + intelligence.qualityScore.turnsToComplete + '</span></div>' +
            '</div>' +
          '</div>' +
          // Tool Usage Card
          '<div class="intel-card">' +
            '<h3>Tool Usage</h3>' +
            '<div class="intel-total">' + intelligence.toolUsage.totalToolCalls + ' total calls</div>' +
            (intelligence.toolUsage.topTools.length > 0 ?
              '<div class="tool-bars">' +
                intelligence.toolUsage.topTools.slice(0, 8).map(function(t) {
                  var maxCount = intelligence.toolUsage.topTools[0].count || 1;
                  var pct = Math.round((t.count / maxCount) * 100);
                  return '<div class="tool-bar-row">' +
                    '<span class="tool-bar-name">' + esc(t.name) + '</span>' +
                    '<div class="tool-bar-track"><div class="tool-bar-fill" style="width:' + pct + '%"></div></div>' +
                    '<span class="tool-bar-count">' + t.count + '</span>' +
                  '</div>';
                }).join('') +
              '</div>'
            : '<div class="muted" style="font-size:13px">No tool data</div>') +
            (intelligence.toolUsage.skillInvocations.length > 0 ?
              '<div class="intel-skills"><span class="muted">Skills:</span> ' + intelligence.toolUsage.skillInvocations.map(function(sk) { return '<span class="tag">' + esc(sk) + '</span>'; }).join(' ') + '</div>'
            : '') +
          '</div>' +
          // Subagent Card
          '<div class="intel-card">' +
            '<h3>Subagents</h3>' +
            '<div class="intel-total">' + intelligence.subagentStats.totalSpawned + ' spawned</div>' +
            (intelligence.subagentStats.topTypes.length > 0 ?
              '<div class="intel-details">' +
                intelligence.subagentStats.topTypes.map(function(t) {
                  return '<div class="intel-row"><span>' + esc(t.type) + '</span><span>' + t.count + '</span></div>';
                }).join('') +
              '</div>'
            : '<div class="muted" style="font-size:13px">No subagent data</div>') +
          '</div>' +
          // Context Window Card
          (intelligence.contextMetrics ?
            '<div class="intel-card">' +
              '<h3>Context Window</h3>' +
              '<div class="intel-total">' + intelligence.contextMetrics.peakTokenCount.toLocaleString() + ' peak tokens</div>' +
              '<div class="intel-details">' +
                '<div class="intel-row"><span>Summarizations</span><span>' + intelligence.contextMetrics.summarizationEvents + '</span></div>' +
                '<div class="intel-row"><span>Growth Rate</span><span>' + intelligence.contextMetrics.tokenGrowthRate.toLocaleString() + ' tokens/turn</span></div>' +
                (intelligence.contextMetrics.turnsBeforeSummarization != null ?
                  '<div class="intel-row"><span>Turns Before Summary</span><span>' + intelligence.contextMetrics.turnsBeforeSummarization + '</span></div>' : '') +
                '<div class="intel-row"><span>Utilization</span><span>' + Math.round(intelligence.contextMetrics.contextUtilization * 100) + '%</span></div>' +
              '</div>' +
              '<div class="context-bar" style="margin-top:12px"><div class="context-bar-fill" style="width:' + Math.round(intelligence.contextMetrics.contextUtilization * 100) + '%"></div></div>' +
            '</div>'
          : '') +
          // Prompt Quality Card
          (intelligence.promptQuality ?
            '<div class="intel-card">' +
              '<h3>Prompt Quality</h3>' +
              '<div class="quality-gauge">' +
                '<div class="gauge-value">' + intelligence.promptQuality.promptEfficiency + '</div>' +
                '<div class="gauge-label">Efficiency</div>' +
              '</div>' +
              '<div class="intel-details">' +
                '<div class="intel-row"><span>Avg Prompt Length</span><span>' + intelligence.promptQuality.avgPromptLength + ' words</span></div>' +
                '<div class="intel-row"><span>Back-and-forth</span><span>' + intelligence.promptQuality.backAndForthScore + '%</span></div>' +
              '</div>' +
              (intelligence.promptQuality.insights.length > 0 ?
                '<div class="pq-insights">' +
                  intelligence.promptQuality.insights.map(function(ins) {
                    var severityClass = ins.severity === 'critical' ? 'pq-critical' : ins.severity === 'warning' ? 'pq-warning' : 'pq-info';
                    return '<div class="pq-insight ' + severityClass + '">' +
                      '<div class="pq-insight-type">' + ins.type.replace(/-/g, ' ') + '</div>' +
                      '<div class="pq-insight-desc">' + esc(ins.description) + '</div>' +
                      '<div class="pq-insight-suggestion">' + esc(ins.suggestion) + '</div>' +
                    '</div>';
                  }).join('') +
                '</div>'
              : '<div class="muted" style="font-size:13px;margin-top:8px">No issues detected</div>') +
            '</div>'
          : '') +
        '</div>'
      : '') +
      (hasGit ?
        '<h2>Git Activity</h2>' +
        '<div class="git-summary">' +
          '<span>' + gitActivity.totalCommits + ' commit' + (gitActivity.totalCommits !== 1 ? 's' : '') + ' on <strong>' + esc(gitActivity.branch) + '</strong></span>' +
          '<span class="git-stats-inline">+' + gitActivity.totalInsertions + ' / -' + gitActivity.totalDeletions + ' lines</span>' +
          '<span>' + gitActivity.totalFilesChanged + ' file' + (gitActivity.totalFilesChanged !== 1 ? 's' : '') + ' changed</span>' +
        '</div>' +
        '<div class="commits-list">' +
          gitActivity.commits.map(function(c) {
            return '<div class="commit-item">' +
              '<span class="commit-hash">' + esc(c.hash) + '</span>' +
              '<span class="commit-message">' + esc(c.message) + '</span>' +
              '<span class="commit-stats">+' + c.insertions + '/-' + c.deletions + '</span>' +
            '</div>';
          }).join('') +
        '</div>'
      : '') +
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

    // Fetch live pricing
    if (models.length && (s.prompt_tokens || s.response_tokens)) {
      fetch('/api/pricing').then(r => r.json()).then(pricing => {
        const model = models[0].toLowerCase();
        let p = pricing[model];
        if (!p) {
          for (const [key, val] of Object.entries(pricing)) {
            if (model.includes(key) || key.includes(model)) { p = val; break; }
          }
        }
        if (p) {
          const cost = (s.prompt_tokens / 1e6) * p.input_price_per_million + (s.response_tokens / 1e6) * p.output_price_per_million;
          const costEl = document.getElementById('cost-stat');
          const valEl = document.getElementById('cost-value');
          costEl.style.display = '';
          valEl.textContent = cost < 0.01 ? '<$0.01' : '$' + cost.toFixed(2);
        }
      }).catch(() => {});
    }

    // Tag management
    const currentTags = tags.slice();
    const tagsContainer = document.getElementById('tags-container');
    const tagInput = document.getElementById('tag-input');
    const tagAdd = document.getElementById('tag-add');

    function renderTags() {
      tagsContainer.innerHTML = currentTags.length === 0
        ? '<span class="muted" style="font-size:13px">No tags</span>'
        : currentTags.map((t, i) =>
            '<span class="tag">' + esc(t) + ' <span class="tag-remove" data-idx="' + i + '">&times;</span></span>'
          ).join('');
    }

    function saveTags() {
      fetch('/api/sessions/' + s.id + '/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: currentTags }),
      });
    }

    tagsContainer.addEventListener('click', function(e) {
      const idx = e.target.dataset?.idx;
      if (idx !== undefined) {
        currentTags.splice(parseInt(idx), 1);
        saveTags();
        renderTags();
      }
    });

    function addTag() {
      const val = tagInput.value.trim();
      if (val && !currentTags.includes(val)) {
        currentTags.push(val);
        saveTags();
        renderTags();
        tagInput.value = '';
      }
    }

    tagAdd.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addTag(); });
    renderTags();
  </script>
</body>
</html>`;
}

export function analyticsPage(analyticsJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptly - Analytics</title>
  <style>${baseStyles()}${analyticsStyles()}</style>
</head>
<body>
  ${navHtml()}
  <main class="container">
    <h1>Analytics</h1>
    <p class="muted">Cross-session insights and trends</p>
    <div id="analytics"></div>
  </main>
  <script>
    const data = ${analyticsJson};
    const el = document.getElementById('analytics');
    var html = '';

    // ─── Project Cost Trends ────────────────────────────────────
    if (data.projectTrends && data.projectTrends.length > 0) {
      html += '<h2>Project Cost Trends</h2>';
      html += '<div class="analytics-table">';
      html += '<div class="analytics-table-header"><span>Project</span><span>Trend</span><span>Periods</span><span>Total Tokens</span></div>';
      data.projectTrends.forEach(function(t) {
        var trendIcon = t.trendDirection === 'rising' ? '<span class="change-up">Rising</span>' :
                        t.trendDirection === 'falling' ? '<span class="change-down">Falling</span>' :
                        '<span class="change-flat">Stable</span>';
        var changeStr = t.changePercent != null ? ' (' + (t.changePercent > 0 ? '+' : '') + t.changePercent + '%)' : '';
        var sparkline = '<div class="sparkline">' + t.periods.map(function(p) {
          var maxTokens = Math.max.apply(null, t.periods.map(function(pp) { return pp.tokens; })) || 1;
          var h = Math.max(2, Math.round((p.tokens / maxTokens) * 28));
          return '<div class="spark-bar" style="height:' + h + 'px" title="' + p.label + ': ' + p.tokens.toLocaleString() + ' tokens, ' + p.sessions + ' sessions"></div>';
        }).join('') + '</div>';
        var totalTokens = t.periods.reduce(function(s, p) { return s + p.tokens; }, 0);
        html += '<div class="analytics-table-row"><span class="project-name">' + esc(t.project) + '</span><span>' + trendIcon + changeStr + '</span><span>' + sparkline + '</span><span>' + totalTokens.toLocaleString() + '</span></div>';
      });
      html += '</div>';
    }

    // ─── Parallel Sessions ──────────────────────────────────────
    if (data.parallelSessions && data.parallelSessions.length > 0) {
      html += '<h2>Parallel Sessions</h2>';
      html += '<p class="muted" style="margin-bottom:12px">' + data.parallelSessions.length + ' overlapping session group' + (data.parallelSessions.length !== 1 ? 's' : '') + ' detected</p>';
      html += '<div class="parallel-groups">';
      data.parallelSessions.forEach(function(g) {
        var tickets = g.sessions.map(function(s) { return '<span class="tag">' + esc(s.ticketId) + '</span>'; }).join(' ');
        var start = new Date(g.overlapStart).toLocaleString();
        var end = new Date(g.overlapEnd).toLocaleString();
        html += '<div class="parallel-card">' +
          '<div class="parallel-tickets">' + tickets + '</div>' +
          '<div class="parallel-meta">' +
            '<span>' + g.overlapMinutes + 'm overlap</span>' +
            '<span>' + g.combinedTokens.toLocaleString() + ' combined tokens</span>' +
            '<span class="muted">' + start + ' - ' + end + '</span>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    // ─── Skill Usage ────────────────────────────────────────────
    if (data.skillUsage && data.skillUsage.skills.length > 0) {
      html += '<h2>Skill Usage</h2>';
      html += '<div class="analytics-table">';
      html += '<div class="analytics-table-header skill-header"><span>Skill</span><span>Invocations</span><span>Sessions</span><span>Avg Quality (Used)</span><span>Avg Quality (Not Used)</span></div>';
      data.skillUsage.skills.forEach(function(sk) {
        html += '<div class="analytics-table-row skill-row">' +
          '<span class="skill-name">' + esc(sk.name) + '</span>' +
          '<span>' + sk.totalInvocations + '</span>' +
          '<span>' + sk.sessionsUsed + '</span>' +
          '<span>' + (sk.avgQualityWhenUsed != null ? sk.avgQualityWhenUsed + '/5' : '-') + '</span>' +
          '<span>' + (sk.avgQualityWhenNotUsed != null ? sk.avgQualityWhenNotUsed + '/5' : '-') + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // ─── Instruction Effectiveness ──────────────────────────────
    if (data.instructionEffectiveness && data.instructionEffectiveness.changes.length > 0) {
      html += '<h2>Instruction File Effectiveness</h2>';
      html += '<div class="instruction-card">';
      html += '<div class="instruction-verdict">' + esc(data.instructionEffectiveness.verdict) + '</div>';
      if (data.instructionEffectiveness.beforeAvgQuality != null && data.instructionEffectiveness.afterAvgQuality != null) {
        html += '<div class="instruction-comparison">';
        html += '<div class="instruction-metric"><div class="instruction-metric-value">' + data.instructionEffectiveness.beforeAvgQuality + '/5</div><div class="instruction-metric-label">Before</div></div>';
        html += '<div class="instruction-arrow">&#x2192;</div>';
        html += '<div class="instruction-metric"><div class="instruction-metric-value">' + data.instructionEffectiveness.afterAvgQuality + '/5</div><div class="instruction-metric-label">After</div></div>';
        html += '</div>';
      }
      html += '<div class="instruction-changes">';
      data.instructionEffectiveness.changes.forEach(function(c) {
        html += '<div class="instruction-change">' +
          '<span class="muted">' + new Date(c.date).toLocaleDateString() + '</span>' +
          '<span>' + esc(c.ticketId) + '</span>' +
          '<span>' + c.files.map(function(f) { return '<span class="tag">' + esc(f) + '</span>'; }).join(' ') + '</span>' +
        '</div>';
      });
      html += '</div></div>';
    }

    // ─── Aggregate Prompt Quality ───────────────────────────────
    if (data.avgPromptEfficiency != null) {
      html += '<h2>Prompt Quality (Aggregate)</h2>';
      html += '<div class="pq-aggregate">';
      html += '<div class="pq-agg-card"><div class="pq-agg-value">' + data.avgPromptEfficiency + '</div><div class="pq-agg-label">Avg Efficiency</div></div>';
      html += '<div class="pq-agg-card"><div class="pq-agg-value">' + data.avgPromptLength + '</div><div class="pq-agg-label">Avg Prompt Length (words)</div></div>';
      html += '<div class="pq-agg-card"><div class="pq-agg-value">' + data.sessionsWithInsights + '</div><div class="pq-agg-label">Sessions with Insights</div></div>';
      html += '</div>';
    }

    if (html === '') {
      html = '<div class="empty"><p>Not enough data for analytics. Complete more sessions to see trends.</p></div>';
    }

    el.innerHTML = html;

    function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function sessionReplayPage(sessionJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptly - Session Replay</title>
  <style>${baseStyles()}${replayStyles()}</style>
</head>
<body>
  ${navHtml()}
  <main class="container">
    <a href="javascript:history.back()" class="back-link">&larr; Back to session</a>
    <div id="replay"></div>
  </main>
  <script>
    const s = ${sessionJson};
    const conversations = JSON.parse(s.conversations || '[]');
    const el = document.getElementById('replay');

    if (conversations.length === 0) {
      el.innerHTML = '<div class="empty"><p>No conversation data to replay.</p></div>';
    } else {
      var currentTurn = 0;
      var playing = false;
      var playTimer = null;
      var speed = 1;
      var sessionStart = new Date(conversations[0].timestamp).getTime();
      var sessionEnd = new Date(conversations[conversations.length - 1].timestamp).getTime();
      var totalDurationMs = sessionEnd - sessionStart;

      // Build timeline markers
      var timelineMarkers = conversations.map(function(t, i) {
        var pos = totalDurationMs > 0 ? ((new Date(t.timestamp).getTime() - sessionStart) / totalDurationMs * 100) : (i / conversations.length * 100);
        var color = t.role === 'user' ? '#6366f1' : t.role === 'assistant' ? '#4ade80' : '#facc15';
        return '<div class="timeline-marker" data-turn="' + i + '" style="left:' + pos + '%;background:' + color + '" title="Turn ' + (i + 1) + ' (' + t.role + ')"></div>';
      }).join('');

      el.innerHTML =
        '<h1>Session Replay: ' + esc(s.ticket_id) + '</h1>' +
        '<div class="replay-controls">' +
          '<button id="btn-prev" class="btn btn-sm" title="Previous">&larr;</button>' +
          '<button id="btn-play" class="btn btn-sm" title="Play/Pause">Play</button>' +
          '<button id="btn-next" class="btn btn-sm" title="Next">&rarr;</button>' +
          '<select id="speed-select" class="filter-select" style="padding:6px 10px">' +
            '<option value="1"' + (speed === 1 ? ' selected' : '') + '>1x</option>' +
            '<option value="2">2x</option>' +
            '<option value="5">5x</option>' +
          '</select>' +
          '<span id="turn-counter" class="muted" style="margin-left:auto">Turn 1 of ' + conversations.length + '</span>' +
        '</div>' +
        '<div class="timeline-bar">' +
          '<div id="timeline-progress" class="timeline-progress"></div>' +
          timelineMarkers +
        '</div>' +
        '<div id="cumulative-stats" class="replay-stats"></div>' +
        '<div id="turn-display"></div>';

      var btnPrev = document.getElementById('btn-prev');
      var btnPlay = document.getElementById('btn-play');
      var btnNext = document.getElementById('btn-next');
      var speedSelect = document.getElementById('speed-select');
      var turnCounter = document.getElementById('turn-counter');
      var turnDisplay = document.getElementById('turn-display');
      var timelineProgress = document.getElementById('timeline-progress');
      var cumulativeStats = document.getElementById('cumulative-stats');

      function renderTurn(idx) {
        currentTurn = Math.max(0, Math.min(idx, conversations.length - 1));
        var t = conversations[currentTurn];
        turnCounter.textContent = 'Turn ' + (currentTurn + 1) + ' of ' + conversations.length;

        // Timeline progress
        var pos = totalDurationMs > 0 ? ((new Date(t.timestamp).getTime() - sessionStart) / totalDurationMs * 100) : (currentTurn / conversations.length * 100);
        timelineProgress.style.width = pos + '%';

        // Timing since previous turn
        var timingHtml = '';
        if (currentTurn > 0) {
          var prev = conversations[currentTurn - 1];
          var gap = (new Date(t.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
          if (gap >= 60) {
            timingHtml = '<div class="turn-timing">' + Math.floor(gap / 60) + 'm ' + Math.round(gap % 60) + 's later</div>';
          } else {
            timingHtml = '<div class="turn-timing">' + Math.round(gap) + 's later</div>';
          }
        }

        // Tool calls
        var toolHtml = '';
        if (t.toolCalls && t.toolCalls.length) {
          toolHtml = '<details class="tool-details" open><summary>' + t.toolCalls.length + ' tool call(s)</summary>' +
            t.toolCalls.map(function(tc) { return '<pre class="tool-pre">' + esc(tc.name) + ': ' + esc(JSON.stringify(tc.input, null, 2)) + '</pre>'; }).join('') +
            '</details>';
        }

        var roleClass = 'turn-' + t.role;
        var time = new Date(t.timestamp).toLocaleTimeString();
        var meta = [time, t.model, t.tokenCount ? t.tokenCount + ' tokens' : ''].filter(Boolean).join(' | ');

        turnDisplay.innerHTML = timingHtml +
          '<div class="turn ' + roleClass + ' replay-turn-active">' +
            '<div class="turn-header"><span class="turn-role">' + t.role.toUpperCase() + '</span><span class="muted">' + meta + '</span></div>' +
            '<pre class="turn-content">' + esc(t.content) + '</pre>' +
            toolHtml +
          '</div>';

        // Cumulative stats
        var cumTokens = 0, cumTools = 0, userMsgs = 0, assistantMsgs = 0;
        for (var i = 0; i <= currentTurn; i++) {
          cumTokens += conversations[i].tokenCount || 0;
          if (conversations[i].toolCalls) cumTools += conversations[i].toolCalls.length;
          if (conversations[i].role === 'user') userMsgs++;
          if (conversations[i].role === 'assistant') assistantMsgs++;
        }
        cumulativeStats.innerHTML =
          '<span>Tokens so far: ' + cumTokens.toLocaleString() + '</span>' +
          '<span>Tool calls: ' + cumTools + '</span>' +
          '<span>User: ' + userMsgs + ' | Assistant: ' + assistantMsgs + '</span>';

        // Highlight active marker
        document.querySelectorAll('.timeline-marker').forEach(function(m, i) {
          m.classList.toggle('active', i === currentTurn);
        });
      }

      function getDelay() {
        if (currentTurn >= conversations.length - 1) return 1000;
        var curr = new Date(conversations[currentTurn].timestamp).getTime();
        var next = new Date(conversations[currentTurn + 1].timestamp).getTime();
        var realGap = next - curr;
        // Cap at 5 seconds real time, minimum 300ms
        return Math.max(300, Math.min(5000, realGap / speed));
      }

      function play() {
        if (playing) return;
        playing = true;
        btnPlay.textContent = 'Pause';
        advance();
      }

      function pause() {
        playing = false;
        btnPlay.textContent = 'Play';
        if (playTimer) { clearTimeout(playTimer); playTimer = null; }
      }

      function advance() {
        if (!playing) return;
        if (currentTurn >= conversations.length - 1) { pause(); return; }
        var delay = getDelay();
        playTimer = setTimeout(function() {
          renderTurn(currentTurn + 1);
          advance();
        }, delay);
      }

      btnPlay.addEventListener('click', function() { playing ? pause() : play(); });
      btnPrev.addEventListener('click', function() { pause(); renderTurn(currentTurn - 1); });
      btnNext.addEventListener('click', function() { pause(); renderTurn(currentTurn + 1); });
      speedSelect.addEventListener('change', function() {
        speed = parseInt(speedSelect.value);
        if (playing) { pause(); play(); }
      });

      // Click on timeline markers
      document.querySelectorAll('.timeline-marker').forEach(function(m) {
        m.addEventListener('click', function() {
          pause();
          renderTurn(parseInt(m.dataset.turn));
        });
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft') { pause(); renderTurn(currentTurn - 1); }
        else if (e.key === 'ArrowRight') { pause(); renderTurn(currentTurn + 1); }
        else if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
      });

      renderTurn(0);
    }

    function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  </script>
</body>
</html>`;
}

export function digestPage(digestJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptly - Weekly Digest</title>
  <style>${baseStyles()}${digestStyles()}</style>
</head>
<body>
  ${navHtml()}
  <main class="container">
    <div id="digest"></div>
  </main>
  <script>
    const digest = ${digestJson};
    const el = document.getElementById('digest');

    function arrow(val) {
      if (val == null) return '';
      if (val > 0) return '<span class="change-up">\u25B2 ' + val + '%</span>';
      if (val < 0) return '<span class="change-down">\u25BC ' + Math.abs(val) + '%</span>';
      return '<span class="change-flat">\u2500 same</span>';
    }

    function num(n) { return n.toLocaleString(); }

    var c = digest.comparison.current;
    var ch = digest.comparison.changes;

    var html = '<h1>Weekly Digest</h1>';
    html += '<p class="muted">' + esc(digest.periodLabel) + ' &middot; compared to ' + esc(digest.previousLabel) + '</p>';

    // Metric cards
    html += '<div class="digest-grid">';
    html += metricCard('Sessions', c.totalSessions, arrow(ch.sessions));
    html += metricCard('Tokens', num(c.totalTokens), arrow(ch.tokens));
    html += metricCard('Messages', num(c.totalMessages), arrow(ch.messages));
    html += metricCard('Avg Duration', c.avgDuration + 'm', '');
    if (c.avgQuality != null) {
      html += metricCard('Avg Quality', c.avgQuality + '/5', ch.quality != null ? arrow(ch.quality) : '');
    }
    if (c.totalCommits > 0) {
      html += metricCard('Commits', c.totalCommits + '', arrow(ch.commits));
    }
    html += '</div>';

    // Git summary
    if (c.totalCommits > 0) {
      html += '<div class="digest-section"><div class="digest-git">+' + num(c.totalInsertions) + ' / -' + num(c.totalDeletions) + ' lines</div></div>';
    }

    // Top projects
    if (digest.topProjects.length > 0) {
      html += '<h2>Top Projects</h2>';
      html += '<div class="digest-table">';
      html += '<div class="digest-table-header"><span>Project</span><span>Sessions</span><span>Tokens</span></div>';
      digest.topProjects.forEach(function(p) {
        html += '<div class="digest-table-row"><span class="project-name">' + esc(p.project) + '</span><span>' + p.sessions + '</span><span>' + num(p.tokens) + '</span></div>';
      });
      html += '</div>';
    }

    // Categories
    if (digest.topCategories.length > 0) {
      html += '<h2>By Category</h2>';
      html += '<div class="digest-categories">';
      digest.topCategories.forEach(function(c) {
        html += '<span class="category-badge category-' + c.category + '">' + c.category + ' (' + c.sessions + ')</span> ';
      });
      html += '</div>';
    }

    // Highlights
    if (digest.highlights.length > 0) {
      html += '<h2>Highlights</h2>';
      html += '<div class="digest-highlights">';
      digest.highlights.forEach(function(h) {
        html += '<div class="digest-highlight">\u2022 ' + esc(h) + '</div>';
      });
      html += '</div>';
    }

    el.innerHTML = html;

    function metricCard(label, value, change) {
      return '<div class="digest-card"><div class="digest-card-value">' + value + '</div><div class="digest-card-label">' + label + '</div>' + (change ? '<div class="digest-card-change">' + change + '</div>' : '') + '</div>';
    }

    function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
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
    .filters { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .search-input { flex: 1; min-width: 200px; padding: 10px 14px; background: #161616; border: 1px solid #333; border-radius: 6px; color: #ededed; font-size: 14px; outline: none; }
    .search-input:focus { border-color: #555; }
    .search-input::placeholder { color: #555; }
    .filter-select { padding: 10px 14px; background: #161616; border: 1px solid #333; border-radius: 6px; color: #ededed; font-size: 14px; outline: none; cursor: pointer; }
    .filter-select:focus { border-color: #555; }
    .export-buttons { display: flex; gap: 8px; margin-bottom: 16px; }
    .btn { padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; cursor: pointer; }
    .btn-sm { background: #222; color: #ededed; border: 1px solid #333; }
    .btn-sm:hover { border-color: #555; }
    .tag { display: inline-block; padding: 2px 8px; background: #1a2a3a; color: #7dd3fc; border-radius: 4px; font-size: 12px; }
    .tag-remove { cursor: pointer; margin-left: 4px; opacity: 0.6; }
    .tag-remove:hover { opacity: 1; }
    .tags-section { margin: 24px 0; }
    .tags-container { margin: 8px 0; }
    .tag-input-row { display: flex; gap: 8px; align-items: center; }
    .charts-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .chart-card { background: #111; border-radius: 8px; padding: 16px; }
    .chart-card h3 { font-size: 14px; color: #888; margin-bottom: 12px; font-weight: 500; }
    .chart-svg { width: 100%; height: auto; }
    .chart-label { fill: #666; font-size: 10px; }
    .chart-hover:hover + rect { opacity: 0.8; }
    .chart-tooltip { display: none; position: absolute; background: #222; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 12px; pointer-events: none; white-space: nowrap; z-index: 10; border: 1px solid #444; }
    .session-card { display: block; padding: 16px; border: 1px solid #222; border-radius: 8px; text-decoration: none; color: #ededed; margin-bottom: 8px; transition: border-color 0.15s; }
    .session-card:hover { border-color: #444; }
    .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .session-header > div { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
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
    .category-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase; }
    .category-bug-fix { background: #3a1a1a; color: #f87171; }
    .category-feature { background: #1a3a1a; color: #4ade80; }
    .category-refactor { background: #1a1a3a; color: #818cf8; }
    .category-investigation { background: #3a2a1a; color: #fbbf24; }
    .category-testing { background: #1a2a3a; color: #38bdf8; }
    .category-docs { background: #2a1a3a; color: #c084fc; }
    .category-other { background: #222; color: #888; }
    .quality-stars { color: #facc15; font-size: 12px; letter-spacing: 1px; }
    .quality-stars-lg { color: #facc15; font-size: 22px; letter-spacing: 2px; }
    .quality-number { font-size: 14px; color: #888; margin-left: 8px; }
    .quality-rating { display: flex; align-items: center; margin-bottom: 12px; }
    .intel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .intel-card { background: #111; border-radius: 8px; padding: 16px; }
    .intel-card h3 { font-size: 13px; color: #888; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .intel-total { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    .intel-details { display: flex; flex-direction: column; gap: 6px; }
    .intel-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #1a1a1a; }
    .intel-row span:first-child { color: #888; }
    .intel-skills { margin-top: 12px; font-size: 13px; }
    .tool-bars { display: flex; flex-direction: column; gap: 6px; }
    .tool-bar-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .tool-bar-name { width: 80px; color: #888; text-align: right; flex-shrink: 0; }
    .tool-bar-track { flex: 1; height: 8px; background: #1a1a1a; border-radius: 4px; overflow: hidden; }
    .tool-bar-fill { height: 100%; background: #6366f1; border-radius: 4px; }
    .tool-bar-count { width: 30px; text-align: right; flex-shrink: 0; }
    .git-badge { color: #facc15; }
    .git-summary { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 12px 16px; background: #111; border-radius: 8px; margin-bottom: 12px; font-size: 14px; }
    .git-stats-inline { color: #4ade80; }
    .commits-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px; }
    .commit-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #111; border-radius: 6px; font-size: 13px; }
    .commit-hash { font-family: ui-monospace, monospace; color: #facc15; background: #2a2a1a; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .commit-message { flex: 1; }
    .commit-stats { color: #4ade80; white-space: nowrap; font-size: 12px; }
    .context-bar { height: 6px; background: #1a1a1a; border-radius: 3px; overflow: hidden; }
    .context-bar-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #facc15, #f87171); border-radius: 3px; }
    .quality-gauge { text-align: center; margin-bottom: 12px; }
    .gauge-value { font-size: 32px; font-weight: 700; color: #4ade80; }
    .gauge-label { font-size: 12px; color: #888; text-transform: uppercase; }
    .pq-insights { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .pq-insight { padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .pq-critical { background: #3a1a1a; border-left: 3px solid #f87171; }
    .pq-warning { background: #3a2a1a; border-left: 3px solid #fbbf24; }
    .pq-info { background: #1a2a3a; border-left: 3px solid #38bdf8; }
    .pq-insight-type { font-weight: 600; text-transform: capitalize; margin-bottom: 4px; }
    .pq-insight-desc { color: #ccc; margin-bottom: 4px; }
    .pq-insight-suggestion { color: #888; font-style: italic; }
  `;
}

function analyticsStyles(): string {
  return `
    .analytics-table { background: #111; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
    .analytics-table-header { display: grid; grid-template-columns: 150px 120px 1fr 120px; padding: 12px 16px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #222; }
    .analytics-table-row { display: grid; grid-template-columns: 150px 120px 1fr 120px; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #1a1a1a; align-items: center; }
    .analytics-table-row:last-child { border-bottom: none; }
    .skill-header { grid-template-columns: 150px 100px 80px 140px 160px; }
    .skill-row { grid-template-columns: 150px 100px 80px 140px 160px; }
    .skill-name { font-family: ui-monospace, monospace; color: #7dd3fc; }
    .sparkline { display: flex; align-items: flex-end; gap: 2px; height: 30px; }
    .spark-bar { width: 20px; background: #6366f1; border-radius: 2px 2px 0 0; min-height: 2px; cursor: default; }
    .spark-bar:hover { background: #818cf8; }
    .project-name { font-weight: 600; font-family: ui-monospace, monospace; }
    .change-up { color: #4ade80; }
    .change-down { color: #f87171; }
    .change-flat { color: #888; }
    .parallel-groups { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .parallel-card { background: #111; border-radius: 8px; padding: 16px; }
    .parallel-tickets { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .parallel-meta { display: flex; gap: 16px; font-size: 13px; color: #888; flex-wrap: wrap; }
    .instruction-card { background: #111; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .instruction-verdict { font-size: 16px; font-weight: 500; margin-bottom: 16px; }
    .instruction-comparison { display: flex; align-items: center; gap: 24px; margin-bottom: 16px; }
    .instruction-metric { text-align: center; }
    .instruction-metric-value { font-size: 24px; font-weight: 700; }
    .instruction-metric-label { font-size: 12px; color: #888; text-transform: uppercase; }
    .instruction-arrow { font-size: 24px; color: #888; }
    .instruction-changes { display: flex; flex-direction: column; gap: 6px; }
    .instruction-change { display: flex; gap: 12px; align-items: center; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #1a1a1a; }
    .instruction-change:last-child { border-bottom: none; }
    .pq-aggregate { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .pq-agg-card { background: #111; border-radius: 8px; padding: 20px; text-align: center; }
    .pq-agg-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .pq-agg-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  `;
}

function replayStyles(): string {
  return `
    .replay-controls { display: flex; align-items: center; gap: 8px; margin: 16px 0; padding: 12px 16px; background: #111; border-radius: 8px; }
    .timeline-bar { position: relative; height: 24px; background: #111; border-radius: 12px; margin-bottom: 16px; overflow: visible; cursor: pointer; }
    .timeline-progress { position: absolute; left: 0; top: 0; height: 100%; background: #1a1a2e; border-radius: 12px; transition: width 0.3s; }
    .timeline-marker { position: absolute; top: 4px; width: 8px; height: 16px; border-radius: 4px; transform: translateX(-50%); cursor: pointer; opacity: 0.6; transition: opacity 0.2s, transform 0.2s; z-index: 1; }
    .timeline-marker:hover, .timeline-marker.active { opacity: 1; transform: translateX(-50%) scaleY(1.2); }
    .replay-stats { display: flex; gap: 24px; font-size: 13px; color: #888; margin-bottom: 16px; }
    .turn-timing { text-align: center; color: #666; font-size: 12px; margin: 8px 0; padding: 4px; }
    .replay-turn-active { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;
}

function digestStyles(): string {
  return `
    .digest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 24px 0; }
    .digest-card { background: #111; border-radius: 8px; padding: 20px; text-align: center; }
    .digest-card-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .digest-card-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .digest-card-change { margin-top: 8px; font-size: 13px; }
    .change-up { color: #4ade80; }
    .change-down { color: #f87171; }
    .change-flat { color: #888; }
    .digest-section { margin: 16px 0; }
    .digest-git { font-size: 14px; color: #4ade80; }
    .digest-table { background: #111; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
    .digest-table-header { display: grid; grid-template-columns: 1fr 100px 120px; padding: 12px 16px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #222; }
    .digest-table-row { display: grid; grid-template-columns: 1fr 100px 120px; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #1a1a1a; }
    .digest-table-row:last-child { border-bottom: none; }
    .project-name { font-weight: 600; font-family: ui-monospace, monospace; }
    .digest-categories { margin: 16px 0 24px; display: flex; flex-wrap: wrap; gap: 8px; }
    .digest-highlights { background: #111; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .digest-highlight { padding: 6px 0; font-size: 14px; color: #ccc; }
  `;
}
