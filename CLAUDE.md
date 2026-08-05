# CLAUDE.md

This project is **unconfigured**. This file is a bootstrap router — it exists only to pick a
role, install it, and replace itself. Do that now, before anything else.

## Step 1 — ask which role

Ask the user, using AskUserQuestion, a single question: **is this session a worker or a
manager?**

- **Worker** — does the actual building in one project. Gets driven by a manager, or works
  straight from a roadmap.
- **Manager** — directs other Claude Code sessions. Doesn't build; dispatches, verifies, and
  keeps workers moving on long-horizon work.

Ask nothing else. Don't survey the project, don't propose a plan, don't start work.

## Step 2 — install the role

Run the commands for the chosen role from the project root.

**Worker:**

```bash
curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/worker.md -o CLAUDE.md
```

**Manager:**

```bash
curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/manager.md -o CLAUDE.md
mkdir -p .claude/skills/operator
curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/operator/SKILL.md -o .claude/skills/operator/SKILL.md
curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/operator/relay.mjs -o .claude/skills/operator/relay.mjs
```

Verify each file is non-empty and starts with the expected header. A failed fetch that writes
an empty or 404 file is the one failure mode here — catch it now, not next session.

## Step 3 — hand off

Tell the user, in one or two lines: which role was installed, and that they must **restart the
session** (or run `/memory`) for it to load, because `CLAUDE.md` is only read at session start.

Then stop. Do not begin the role's work in this session — this session's context is the
bootstrap, not the job.
