# SKILLS

Role files for Claude Code, served over HTTPS. Pull one line into a new folder and the session
configures itself.

## Start

In a new folder, start Claude and paste:

```
! curl -sL https://raw.githubusercontent.com/Sivx/SKILLS/main/CLAUDE.md -o CLAUDE.md
```

Restart the session. It asks which role, installs it, and stops. Restart once more — done.

## Roles

| Role | What it does |
| --- | --- |
| **worker** | Builds, in one project. |
| **manager** | Directs other sessions — dispatches, verifies, unblocks. |
| **autoruns** | Launcher. Keeps a project list and spins projects up. |

**autoruns** is its own folder (e.g. `C:\dev\autoruns`). Tell it a project's path and opening
prompt; ask it to start one any time. Add and remove projects in plain language.

## Boss mode

A lone worker stops after each step and waits. A **boss** keeps it moving, and a boss can be
bossed. Ask autoruns to start a project *with a boss*:

```
C:/dev/ApexTrader                worker — does the work
C:/dev/ApexTrader/_boss          drives the worker
C:/dev/ApexTrader/_boss/_boss    drives that boss
```

`_boss/` is gitignored, so nothing leaks into the project's history. Each level polls slower
than the one below and only the top talks to you. Levels can be added while everything runs.

## Notes

- Needs `node` and a signed-in Claude Code.
- Spawned sessions die if their terminal closes.
- Right after a push, GitHub may serve a cached copy for ~5 min — add `?v=2` to bust it.
