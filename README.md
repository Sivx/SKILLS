# SKILLS

Role files and skills for Claude Code, served over HTTPS. Start a new folder, pull one line,
pick a role, and the session is configured.

## Requirements

- `node` 18+ on PATH — the operator skill's relay is plain Node, no dependencies.
- A signed-in Claude Code (`~/.claude/.credentials.json`). The relay reads that token.
- Only sessions started with `/remote-control` (or spawned by `operator`) are reachable.

## Quick start

Start Claude in the new folder and paste:

```
! curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/CLAUDE.md -o CLAUDE.md
```

The `!` prefix runs the command directly — zero model tokens, no tool call, byte-exact copy.

Then **restart the session** (or run `/memory`): `CLAUDE.md` is only read at session start.
On the next turn it asks which role this is, installs it over itself, and stops. Restart once
more and the role is live.

## Roles

The `CLAUDE.md` you pull is a **bootstrap router**. It runs exactly once per project, then
replaces itself — so a project ends up with only its own role, never the router.

| Role | Becomes | What it does |
| --- | --- | --- |
| **worker** | `worker.md` | Builds, in one project. Driven by a boss, or working a roadmap alone. |
| **manager** | `manager.md` + `operator` skill | Directs other sessions. Dispatches, verifies, unblocks. |
| **autoruns** | `autoruns.md` + `operator` skill | Launcher. Keeps a project registry and spins projects up. |

### operator

The skill that makes the rest work. It talks to the Remote Control relay directly — no server,
no browser, no MCP tools:

```bash
node .claude/skills/operator/relay.mjs list [--rc] [--fresh=min] [--id=<a>,<b>]
node .claude/skills/operator/relay.mjs status <id> [tail]     # row + last assistant text
node .claude/skills/operator/relay.mjs read <id> [tail] [--assistant]
node .claude/skills/operator/relay.mjs send <id> "instruction"
node .claude/skills/operator/relay.mjs spawn <cwd> [--name=] [--model=] [--prompt=] [--safe]
```

`spawn` launches a named session in a folder and returns its relay id — that name is how a
manager knows which session is its worker. Spawned sessions run with permissions bypassed by
default, since a permission prompt with nobody watching is a hung worker; `--safe` restores
prompts.

### autoruns

A dedicated folder (e.g. `C:\dev\autoruns`) whose only job is starting projects. It owns a
local `projects.json` — name, path, and a self-contained opening prompt per project — and
spawns them on request, installing `worker.md` into a project that has no `CLAUDE.md`. Add,
remove, and edit projects by asking it in plain language. The registry stays on your machine
and is not part of this repo.

It launches and stops. It does not poll or shepherd — that's a boss's job.

### Boss mode

A lone worker stops after each step and waits. A **boss** is a manager session that keeps it
moving, and a boss can itself be bossed. Each level nests inside the one below:

```
C:/dev/ApexTrader                worker — does the work (the repo)
C:/dev/ApexTrader/_boss          drives the worker
C:/dev/ApexTrader/_boss/_boss    drives that boss
```

The whole stack lives in the effort's own tree and disappears with it. Autoruns adds `_boss/`
to the project's root `.gitignore` before the first spawn — one entry covers every depth — so
scaffolding stays out of the effort's history and out of the worker's `git status`.

Ask autoruns for a project *with a boss* and it builds the stack **bottom-up**: spawn the
worker, then create each `_boss` folder with `manager.md`, the operator skill, and a **charter**
naming the exact session id it drives, its poll interval, and its stop condition. The charter
lives in that boss's `CLAUDE.md` so it survives a `/clear`.

Each level polls 2–3× slower than the one below (5m / 15m / 45m by default). Only the top level
talks to you; everything below escalates to its parent. Levels can be added to a running stack
without restarting anything underneath.

## Testing the flow

1. New empty folder → start Claude → run the `!` command above → restart.
2. Say anything. It should ask **worker / manager / autoruns**, install that role over
   `CLAUDE.md`, tell you to restart, and stop without starting the role's work.
3. Restart. The role is live and the router is gone.

For autoruns specifically, give it a project with a real roadmap and ask it to start that
project *with a boss*. Then verify on disk rather than from its report: `projects.json` has a
`chain` entry per level, `<project>/_boss/CLAUDE.md` ends with a charter naming the worker's
session id, `git status` in the project is clean, and commits appear as steps land.

## Gotchas

- **Spawned sessions die with their terminal.** Closing the window (or a reboot) ends the
  session; the relay keeps the record but nothing is running. Check `ageMin`, not `connection`.
- **`--rc` misses sessions spawned by name.** The `remote-control-auto` tag only applies to
  auto-named sessions, so `list --rc` and `live` won't show them. Track them with
  `list --id=<a>,<b>`.
- **`raw.githubusercontent.com` caches for ~5 minutes.** Right after a push a fetch may serve
  the old version. Bust it with a query string while testing:
  `curl -sL ".../CLAUDE.md?v=2" -o CLAUDE.md`
- **Slash commands from Git Bash** get a leading `/` rewritten to a Windows path. Prefix
  `MSYS_NO_PATHCONV=1`, or send from PowerShell.
- **A persistent 401** means the token expired — run any `claude` command to refresh it.

## Updating

Edit here, commit, push. New projects get it on their next pull; existing projects keep the
copy they pulled until they pull again.
