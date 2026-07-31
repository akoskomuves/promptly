/**
 * The MCP App rendered by `promptly_review` — an interactive verdict panel
 * instead of a wall of text.
 *
 * Shipped as a string rather than an .html file on purpose: this package builds
 * with plain `tsc`, which copies no assets, so a separate file would have to be
 * hand-copied into `dist` and would silently go missing from the published
 * tarball the first time someone forgot.
 *
 * The page talks the MCP Apps postMessage dialect directly (JSON-RPC over
 * `window.parent.postMessage`) rather than bundling `@modelcontextprotocol/ext-apps`'s
 * `App` class — the spec explicitly allows this, and the pre-bundled `App` is
 * ~330KB, which the host would re-fetch on every render. What we need is small:
 * the `ui/initialize` handshake, the `ui/notifications/tool-result` event, and
 * one `tools/call` back for re-run.
 */

/** The MCP Apps protocol revision this page speaks. */
export const APPS_PROTOCOL_VERSION = "2026-01-26";

export const REVIEW_APP_URI = "ui://promptly/review.html";

export const REVIEW_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prompt Review</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --panel: #f6f7f9; --line: #e3e6ea;
    --fg: #14161a; --muted: #6b7280;
    --good: #1a7f56; --warn: #b45309; --bad: #b42318;
    --track: #e3e6ea; --accent: #4f46e5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --panel: #171a21; --line: #262b35;
      --fg: #e8eaed; --muted: #9aa3af;
      --good: #35d08c; --warn: #f0b429; --bad: #f2635a;
      --track: #262b35; --accent: #8b85f5;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  h1 { font-size: 15px; margin: 0 0 2px; font-weight: 600; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 14px; }
  /* 2x2 by default — an app panel in a chat column is narrow, and flex-wrap
     stranded the fourth tile on its own full-width row. Widen to a single row
     only when there's genuinely space for four. */
  .scores { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
  @media (min-width: 560px) { .scores { grid-template-columns: repeat(4, 1fr); } }
  .tile {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 10px 12px; min-width: 0;
  }
  .tile .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .tile .value { font-size: 22px; font-weight: 650; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .tile .value small { font-size: 12px; font-weight: 500; color: var(--muted); }
  .good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  section { margin-top: 16px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  .rubric { margin-bottom: 10px; }
  .rubric .row { display: flex; align-items: center; gap: 10px; }
  .rubric .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rubric .n { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 34px; text-align: right; }
  .bar { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; margin-top: 5px; }
  .bar > i { display: block; height: 100%; border-radius: 3px; background: currentColor; }
  .note {
    margin-top: 6px; padding: 8px 10px; background: var(--panel);
    border-left: 2px solid currentColor; border-radius: 0 6px 6px 0;
    font-size: 12.5px; color: var(--fg);
  }
  .note b { font-weight: 600; }
  .warnbar {
    margin: -4px 0 14px; padding: 8px 10px; border-radius: 8px;
    background: var(--panel); border: 1px solid var(--line);
    border-left: 3px solid var(--warn); color: var(--fg); font-size: 12.5px;
  }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.model { color: var(--muted); font-size: 12px; }
  ul.recs { list-style: none; margin: 0; padding: 0; }
  ul.recs li { padding: 6px 0; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: baseline; }
  ul.recs li:last-child { border-bottom: 0; }
  .sev { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; min-width: 56px; }
  footer { margin-top: 18px; display: flex; align-items: center; gap: 10px; }
  button {
    font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .55; cursor: default; }
  .status { color: var(--muted); font-size: 12px; }
  .empty { color: var(--muted); padding: 12px 0; }
</style>
</head>
<body>
<main id="root"><p class="empty">Waiting for review…</p></main>

<script>
(function () {
  "use strict";

  var PROTOCOL_VERSION = "__APPS_PROTOCOL_VERSION__";
  var nextId = 1;
  var pending = {};
  var lastPrNumber = null;

  function send(msg) { window.parent.postMessage(msg, "*"); }

  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }

  function notify(method, params) {
    send({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      var slot = pending[msg.id];
      if (!slot) return;
      delete pending[msg.id];
      if (msg.error) slot.reject(new Error(msg.error.message || "request failed"));
      else slot.resolve(msg.result);
      return;
    }

    if (msg.method === "ui/notifications/tool-result") {
      var p = msg.params || {};
      render(p.structuredContent || null, p.content || []);
    }
  });

  // Handshake first; the host may keep the iframe hidden until it completes.
  request("ui/initialize", {
    appInfo: { name: "promptly-review", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION
  }).then(function () {
    notify("ui/notifications/initialized", {});
  }).catch(function () {
    // An older or stricter host may reject the handshake. The panel still
    // renders whatever result arrives; it just can't call tools back.
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function usd(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    return n < 0.01 && n > 0 ? "<$0.01" : "$" + n.toFixed(2);
  }
  // null cost means the model had no price — unknown, not free. Say so, rather
  // than rendering "$0.00" next to a session that may have been the priciest.
  function sessionCost(n) { return n == null ? "unpriced" : usd(n); }
  function tone(score) { return score >= 7 ? "good" : score >= 5 ? "warn" : "bad"; }

  function scoreTile(label, score) {
    if (score == null) {
      return '<div class="tile"><div class="label">' + esc(label) +
             '</div><div class="value"><small>not scored</small></div></div>';
    }
    return '<div class="tile"><div class="label">' + esc(label) +
           '</div><div class="value ' + tone(score) + '">' + score + '<small>/10</small></div></div>';
  }

  function render(data, content) {
    var root = document.getElementById("root");

    if (!data || data.reviewed !== true) {
      var reason = (data && data.error) ||
        (content && content[0] && content[0].text) || "The review could not run.";
      root.innerHTML = '<h1>Prompt Review</h1><p class="empty">' + esc(reason) + "</p>";
      return;
    }

    lastPrNumber = data.prNumber;
    var html = "";

    html += "<h1>Prompt Review · PR #" + esc(data.prNumber) +
            (data.prTitle ? " · " + esc(data.prTitle) : "") + "</h1>";
    html += '<div class="sub">' + esc(data.sessionCount) +
            (data.sessionCount === 1 ? " session" : " sessions") + " · " +
            esc((data.totalTokens || 0).toLocaleString()) + " tokens</div>";

    html += '<div class="scores">';
    html += scoreTile("Quality", data.qualityScore);
    html += scoreTile("Spend", data.spendEfficiency);
    var unpriced = data.unpricedSessions || 0;
    html += '<div class="tile"><div class="label">Cost' + (unpriced ? " (min)" : "") +
            '</div><div class="value">' + usd(data.totalCostUsd) + "</div></div>";
    html += '<div class="tile"><div class="label">Avoidable</div><div class="value ' +
            (data.avoidableUsd > 0.005 ? "warn" : "") + '">' + usd(data.avoidableUsd) +
            "</div></div>";
    html += "</div>";

    // An understated total is worse than no total, so name it rather than
    // letting the tiles imply the figures are complete.
    if (unpriced) {
      html += '<div class="warnbar">' + esc(unpriced) +
              (unpriced === 1 ? " session has" : " sessions have") +
              " no price for its model — cost is a floor, and spend can't be scored." +
              "</div>";
    }

    if (data.rubrics && data.rubrics.length) {
      html += "<section><h2>Rubrics</h2>";
      data.rubrics.forEach(function (r) {
        var t = tone(r.score10);
        var weakest = r.id === data.weakestRubricId;
        html += '<div class="rubric ' + t + '">';
        html += '<div class="row"><span class="name">' + esc(r.title) +
                (weakest ? " ▲" : "") + '</span><span class="n">' + r.score10 + "</span></div>";
        html += '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, r.score10 * 10)) + '%"></i></div>';
        if (weakest && r.worst) {
          html += '<div class="note"><b>Weakest: ' + esc(r.worst.ticketId) + "</b> (" +
                  esc(r.worst.score) + "/5) — " + esc(r.worst.note) + "</div>";
        }
        html += "</div>";
      });
      html += "</section>";
    }

    if (data.recommendations && data.recommendations.length) {
      html += '<section><h2>Recommendations</h2><ul class="recs">';
      data.recommendations.forEach(function (rec) {
        var t = rec.severity === "critical" ? "bad" : rec.severity === "warning" ? "warn" : "good";
        html += '<li><span class="sev ' + t + '">' + esc(rec.severity) + "</span><span>" +
                esc(rec.title) + "</span></li>";
      });
      html += "</ul></section>";
    }

    if (data.sessions && data.sessions.length) {
      html += "<section><h2>Sessions</h2><div class=\"scroll\"><table><thead><tr>" +
              "<th>Ticket</th><th>Model</th><th class=\"num\">Cost</th>" +
              "</tr></thead><tbody>";
      data.sessions.forEach(function (s) {
        html += "<tr><td>" + esc(s.ticketId || "—") + '</td><td class="model">' +
                esc(s.model || "—") + '</td><td class="num">' + sessionCost(s.costUsd) + "</td></tr>";
      });
      html += "</tbody></table></div></section>";
    }

    html += '<footer><button id="rerun">Re-run review</button>' +
            '<span class="status" id="status"></span></footer>';

    root.innerHTML = html;

    var btn = document.getElementById("rerun");
    var status = document.getElementById("status");
    btn.addEventListener("click", function () {
      btn.disabled = true;
      status.textContent = "Re-running…";
      request("tools/call", { name: "promptly_review", arguments: { prNumber: lastPrNumber } })
        .then(function (result) {
          render(result && result.structuredContent, (result && result.content) || []);
        })
        .catch(function (err) {
          btn.disabled = false;
          status.textContent = err.message || "Re-run failed.";
        });
    });
  }
})();
</script>
</body>
</html>`.replace("__APPS_PROTOCOL_VERSION__", APPS_PROTOCOL_VERSION);
