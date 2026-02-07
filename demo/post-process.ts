/**
 * HTML post-processor for the Promptly demo.
 * Adapts dashboard-generated HTML for static demo deployment:
 * - Injects a demo banner
 * - Disables export buttons
 * - Disables tag editing
 * - Inlines static pricing data (replaces fetch('/api/pricing'))
 */

// ─── Static pricing data ─────────────────────────────────────────────────

const STATIC_PRICING = JSON.stringify({
  "claude-sonnet-4-5-20250929": {
    input_price_per_million: 3,
    output_price_per_million: 15,
  },
  "claude-opus-4-5-20250414": {
    input_price_per_million: 15,
    output_price_per_million: 75,
  },
  "gpt-4o": {
    input_price_per_million: 2.5,
    output_price_per_million: 10,
  },
  "gemini-2.0-flash": {
    input_price_per_million: 0.1,
    output_price_per_million: 0.4,
  },
  "gemini-2.5-pro": {
    input_price_per_million: 1.25,
    output_price_per_million: 10,
  },
  "o3-mini": {
    input_price_per_million: 1.1,
    output_price_per_million: 4.4,
  },
});

// ─── Demo banner ──────────────────────────────────────────────────────────

const DEMO_BANNER = `
<div style="position:fixed;top:0;left:0;right:0;z-index:1000;background:#1a1a2e;border-bottom:1px solid #333;padding:10px 24px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;font-family:system-ui,-apple-system,sans-serif;">
  <span style="color:#ccc;">This is a demo with sample data.</span>
  <a href="https://getpromptly.xyz" style="color:#818cf8;text-decoration:none;font-weight:600;">Get Started &rarr;</a>
</div>`;

// ─── Toast notification for disabled features ─────────────────────────────

const DEMO_TOAST_SCRIPT = `
<script>
  window.__demoToast = function(msg) {
    var existing = document.getElementById('demo-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'demo-toast';
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#ededed;padding:10px 20px;border-radius:8px;font-size:14px;z-index:10000;transition:opacity 0.3s;';
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2500);
  };
</script>`;

// ─── Post-processing functions ────────────────────────────────────────────

export function injectDemoBanner(html: string): string {
  // Add body padding and inject banner
  html = html.replace("<body>", `<body style="padding-top:48px;">${DEMO_BANNER}`);
  // Inject toast helper script before </body>
  html = html.replace("</body>", `${DEMO_TOAST_SCRIPT}\n</body>`);
  return html;
}

export function disableExports(html: string): string {
  // Replace export JSON/CSV links with disabled buttons
  html = html.replace(
    /<a href="\/api\/sessions\/export\.json"[^>]*>Export JSON<\/a>/,
    `<button class="btn btn-sm" disabled style="opacity:0.5;cursor:not-allowed;" title="Install Promptly to export" onclick="window.__demoToast('Install Promptly to export data')">Export JSON</button>`
  );
  html = html.replace(
    /<a href="\/api\/sessions\/export\.csv"[^>]*>Export CSV<\/a>/,
    `<button class="btn btn-sm" disabled style="opacity:0.5;cursor:not-allowed;" title="Install Promptly to export" onclick="window.__demoToast('Install Promptly to export data')">Export CSV</button>`
  );
  return html;
}

export function disableTagEditing(html: string): string {
  // Replace the entire saveTags function with a no-op toast.
  // The original contains nested braces from the fetch options object,
  // so we match the literal text pattern instead of using a brace-counting regex.
  const original = `function saveTags() {
      fetch('/api/sessions/' + s.id + '/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: currentTags }),
      });
    }`;
  const replacement = `function saveTags() { window.__demoToast('Install Promptly to edit tags'); }`;
  html = html.replace(original, replacement);
  return html;
}

export function inlinePricing(html: string): string {
  // Replace fetch('/api/pricing') calls with static data
  // Sessions list page pattern
  html = html.replace(
    /fetch\('\/api\/pricing'\)\.then\(r => r\.json\(\)\)\.then\(models => \{/,
    `Promise.resolve(${STATIC_PRICING}).then(models => {`
  );
  // Session detail page pattern
  html = html.replace(
    /fetch\('\/api\/pricing'\)\.then\(r => r\.json\(\)\)\.then\(pricing => \{/,
    `Promise.resolve(${STATIC_PRICING}).then(pricing => {`
  );
  return html;
}

/**
 * Apply all demo post-processing to an HTML string.
 */
export function postProcess(html: string): string {
  html = injectDemoBanner(html);
  html = disableExports(html);
  html = disableTagEditing(html);
  html = inlinePricing(html);
  return html;
}
