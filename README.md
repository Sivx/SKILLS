# SKILLS

Canonical `CLAUDE.md` (and skills) served over HTTPS. Start a new project, pull the latest
copy from `main`, and the session is configured.

## Roles

The `CLAUDE.md` you pull is a **bootstrap router**. It asks which role the session is, fetches
that role file over itself, and gets out of the way — so it runs exactly once per project.

| Role | Becomes | What it does |
| --- | --- | --- |
| **worker** | `worker.md` | Builds, in one project. Driven by a manager or working a roadmap. |
| **manager** | `manager.md` + `operator` skill | Directs other sessions. Dispatches, verifies, unblocks. |
| **autoruns** | `autoruns.md` + `operator` skill | Launcher. Keeps a project registry and spins projects up as workers. |

Roles install to `CLAUDE.md`, so a project ends up with only its own role — never the router.

### autoruns

A dedicated folder (e.g. `C:\dev\autoruns`) whose only job is starting projects. It owns a
local `projects.json` — name, path, and a self-contained opening prompt per project — and on
request spawns each as a worker session, bootstrapping the project with `worker.md` first if it
has no `CLAUDE.md`. Add and remove projects by asking it. The registry stays on your machine;
it is not part of this repo.

### Boss mode

A lone worker stops after each step and waits. A **boss** is a manager session that keeps it
moving — and a boss can itself be bossed. The hierarchy is encoded in the folder name, so
nesting is just another suffix:

```
C:/dev/ApexTrader                worker — does the work
C:/dev/ApexTrader/_boss          drives the worker
C:/dev/ApexTrader/_boss/_boss    drives that boss
```

Everything for one effort stays inside that effort's repo. `_boss/` is added to the repo's
`.git/info/exclude`, so the scaffolding never enters the project's history and never shows up
as untracked clutter to the worker.

Ask autoruns for a project *with a boss* and it builds the stack bottom-up: spawn the worker,
then create each `_boss` folder with `manager.md`, the operator skill, and a **charter** naming
the exact session id it drives, its poll interval, and its stop condition. Each level polls 2–3×
slower than the one below. Only the top level talks to you; everything below escalates to its
parent.

## Pull into a new folder

Start Claude in the empty folder and paste:

```
! curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/CLAUDE.md -o CLAUDE.md
```

The `!` prefix runs the command directly in the session — zero model tokens, no tool call,
no permission prompt, byte-exact copy.

If you want Claude to fetch *and* read it in the same turn:

```
curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/CLAUDE.md -o CLAUDE.md then read it
```

Paste the literal command rather than asking in natural language ("grab my CLAUDE.md from
GitHub") — no guessing at the URL, and no risk of the fetch reformatting the file instead
of saving it verbatim.

## Loading it

`CLAUDE.md` is read at **session start**. After pulling it, either restart the session or
run `/memory` to pick it up.

## Testing the flow

1. New empty folder, start Claude.
2. Run the `!` command above.
3. Restart the session.
4. Say `hello` — the current `CLAUDE.md` should make it reply `CLAUDE.md v1 loaded.`

## Caching

`raw.githubusercontent.com` caches for roughly 5 minutes. Right after a push, a fetch may
still serve the previous version. Append a changing query string to bust it while testing:

```
! curl -sL "https://raw.githubusercontent.com/Sivx/SKILLS/main/CLAUDE.md?v=2" -o CLAUDE.md
```

## Updating

Edit `CLAUDE.md` here, commit, push. Every new project that pulls afterwards gets it.
Existing projects keep the copy they pulled until they pull again.
