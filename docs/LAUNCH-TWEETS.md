# Launch Tweet Thread

Copy-paste each tweet separately. Thread format.

---

**Tweet 1/5**

I built Promptly — a local-first analytics tool for AI coding sessions.

It captures every conversation you have with Claude Code, Gemini CLI, or Codex CLI, tags them to tickets, and gives you a dashboard to review what happened.

Free, open source, runs on your machine.

npm i -g @getpromptly/cli

---

**Tweet 2/5**

The problem: AI coding tools don't give you a way to review past conversations.

You finish a 2-hour session with Claude Code, close the terminal, and it's gone. No record of what was discussed, what tokens were used, or what decisions were made.

Promptly fixes that.

---

**Tweet 3/5**

How it works:

```
promptly init           # one-time MCP setup
promptly start TASK-42  # start logging
# ... work with Claude Code ...
promptly finish         # save session
promptly serve          # view dashboard
```

Everything stays on your machine. SQLite. No accounts. No cloud.

---

**Tweet 4/5**

It uses MCP (Model Context Protocol) — the same standard that Claude Code, Codex CLI, and Gemini CLI all support.

One install works across tools. No vendor lock-in.

GitHub: github.com/akoskomuves/promptly

---

**Tweet 5/5**

Coming next:

- Token cost estimation per model
- Session search and export
- Optional cloud mode for teams

Try it: getpromptly.xyz

Feedback welcome — this is v0.1.
