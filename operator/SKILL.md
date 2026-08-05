---
name: operator
description: Inspect and drive other Claude Code sessions over the Remote Control relay — list what is running, read what a session is doing, and send it work. Use this to act as manager/director over a fleet of worker sessions on long-horizon tasks: dispatch scoped assignments, verify claims against disk, unblock stalls, and keep workers grinding unattended. Triggers on "what sessions are running", "check on that session", "send this to X", "drive/boss/babysit that session", "keep it going", "manage the workers", or any request to coordinate work across more than one session.
---

# operator

You are not doing the work. You are directing sessions that do the work.

This skill gives you three primitives — **see** what sessions exist, **read** what one is
doing, **send** it an instruction — and the operating doctrine for using them well. Long-horizon
work fails in a single session because context fills, attention drifts, and one bad turn
poisons everything downstream. It survives across a fleet because each worker holds a small,
fresh, well-scoped assignment and you hold the plan.

Your leverage is judgment, not typing. Spend your context on deciding *what* should happen and
*verifying* that it did. Spend the workers' context on doing it.

## Requirements

- `node` (v18+) on PATH.
- A signed-in `~/.claude/.credentials.json` — the script reads the OAuth token and calls
  `api.anthropic.com/v1/code/sessions` directly, the same way claude.ai/code and the Claude app do.
- Nothing else. No server, no browser, no MCP tools, no extra config.

`relay.mjs` sits next to this file and is fully self-contained: copy this folder to any machine
with a signed-in Claude Code and it works. Run commands from this skill's directory, or use the
absolute path to `relay.mjs` from anywhere.

Only sessions started with `/remote-control` are reachable. If a target isn't listed, it wasn't
started that way.

## Commands

- **List sessions (cross-machine), newest activity first:**
  `node relay.mjs list`
  JSON per session: `id` (a `cse_…` uuid — pass to `read`/`status`/`send`), `title`,
  `remoteControl`, `worker` (`running`/`idle`), `bucket`, `connection`, `ageMin` (minutes since
  last event), `lastEventAt`, `live`.
  - `--rc` — only `/remote-control` sessions.
  - `--fresh[=min]` — only sessions active within `min` minutes (default 60).
  - `--id=<id>[,<id>…]` — only these sessions, however stale. The cheapest way to poll a known
    target or a fixed fleet; bypasses `--fresh`.

- **What is actually live right now:**
  `node relay.mjs live [min]`   (default 30) — shorthand for `list --rc --fresh=min`.

- **Read a session's recent transcript:**
  `node relay.mjs read <id> [tailChars]`   (default 4000)
  - `--assistant` — assistant prose only, no tool calls or results. Far cheaper when you want
    what the session *said*, not everything it ran.

- **One-call "what is it doing?":**
  `node relay.mjs status <id> [tailChars]`
  The `list` row plus `lastAssistant` (assistant-only tail, default 1200 chars). This is the
  right per-check command in a polling loop — roughly a quarter the cost of a raw `read`.

- **Send a prompt into a session (lands as a user turn):**
  `node relay.mjs send <id> "your instruction here"`

- **Spawn a new session in a project folder:**
  `node relay.mjs spawn <cwd> [--name=<name>] [--model=<model>] [--prompt=<text>]`
  Launches `claude --remote-control <name>` in `cwd`, waits for it to register, and prints
  `{id, name, cwd}`. With `--prompt`, it also sends the opening assignment once the session is
  up. Use this when a project has no worker yet.
  - `claude` is an interactive TUI and needs a real terminal, so this opens one: a console
    window on Windows, Terminal on macOS, `setsid script` on Linux (which works headless over
    ssh). Override the binary with `CLAUDE_BIN`.
  - Registration takes a few seconds; the command polls for up to 60s before giving up.

## Knowing which session is your worker

Sessions are not self-identifying, so establish identity deliberately. In order of reliability:

1. **Name it at spawn.** `spawn --name=<name>` passes the name to `claude --remote-control`,
   and it comes back as the session's `title`. You chose it, so you know it — no guessing. Use
   a scheme you can reconstruct later, like `op-<project>-<n>`.
2. **Diff the list around a spawn.** If a session appeared between your before and after
   snapshots, that's yours. `spawn` already does this as a fallback when the name doesn't stick.
3. **Match on `repo`.** Each row carries the GitHub repo it's working in. This narrows a fleet
   fast, but it identifies a *repository*, not a folder — two workers in the same repo (or in
   separate worktrees of it) look identical. Never rely on it alone when a repo has more than
   one worker.
4. **Read a commit trailer.** Commits carry `Claude-Session: …/session_<ULID>`, and the relay id
   is `cse_<same ULID>`. So any commit tells you exactly which session produced it — the way to
   attribute finished work after the fact, even for sessions you didn't spawn.

Ask a session to identify itself only as a last resort: it costs it a turn, and a worker's
self-report is a claim like any other.

**`--rc` will miss sessions you spawned by name.** The `remote-control-auto` tag is only applied
to auto-named sessions, so a `spawn --name=…` worker has `remoteControl: false` and is invisible
to both `--rc` and `live`. Track spawned workers by their ids with `list --id=<a>,<b>` — which is
the cheaper way to poll a known fleet regardless.

## Reading a worker without reading its transcript

Every row carries the worker's own end-of-turn self-report, which is far cheaper than a `read`:

- `need` — `working`, `review_ready`, `need_input`, … the fastest signal that a session is
  waiting on something rather than simply done.
- `detail` — one line on where it actually is.
- `needsAction` — what it says it needs from you.

Treat these as a claim, not proof — `detail` says what the worker believes it did. Verify
anything that matters against disk and git. But as a triage filter over a fleet, it tells you
which worker to look at for roughly the cost of a `list`.

## Liveness: trust recency, not connection

The relay is append-only and **never reaps** ended sessions. `connection` stays `connected` on
records that are days dead, so it is not a liveness signal. The trustworthy signal is **recency**
(`ageMin` / `lastEventAt`). Use `live` / `--fresh` to cut through the zombie backlog — a bare
`list` can return dozens of stale rows. `send <id> "/exit"` ends a session, but its record
lingers until the relay ages it out.

`worker` is `running` for the *whole* turn including every tool call, flipping to `idle` about
two seconds after the turn ends. A long build legitimately holds `running` for many minutes —
that is faithful, not stuck. Do not "help" a running worker.

## Directing doctrine

**Spawn a worker rather than reusing a stranger.** If a project has no session, start one with
`spawn` and give it the assignment in the same move. A fresh session with a self-contained brief
beats an existing one carrying unrelated context — and you know its identity because you named it.

**Recon before dispatch — always.** Before sending work anywhere, check what is live and read
the target repo's `git status` and recent log. A dirty working tree is a stop sign: another
session may be mid-flight in it. Sending a prompt is irreversible — the agent acts immediately.
When it's the user's fleet, show them what's in motion and what you propose to send *before*
sending it.

**Every prompt must be self-contained.** A worker may read your instruction with no context at
all — after a `/clear`, or as a fresh session. Name the absolute project path, the files to
read, and the full definition of done. Anything the worker "just knows" from earlier setup
evaporates at the first clear. This single property is what makes unattended and nested
operation possible.

**Drive on minimal context.** One `send` per assignment. Verify by checking deliverable files
on disk, not by reading transcripts. Read a transcript tail only when a worker looks stuck, and
keep it small. Make every deliverable a *file* — files are the shared memory between sessions;
transcripts stay private to each worker. A well-driven worker should cost your window a few
hundred tokens per cycle.

**Verify claims; never take a worker's word.** "Done" is a claim, not a fact. The artifact
exists on disk, the tests are green, and `git log` names the work — or it isn't done. A worker
reporting a finish it never landed is the one failure an unattended loop cannot otherwise see,
and it costs two commands to rule out. Report what you verified, not what you were told.

**Don't inject mid-turn.** A `send` lands as a user turn. Wait for `worker: idle` before
redirecting, unless you mean to interrupt.

**Parallel workers in one tree need explicit file ownership.** Tell each worker which files it
owns, that others are working the same tree, and to stage only its own files. Serialize anything
cross-cutting. Better still, give each worker its own directory or worktree.

**Right-size the worker.** Well-scoped mechanical work runs fine on a cheaper model at moderate
effort; save the expensive model for judgment. Slash commands travel over `send` (`/model`,
`/clear`, `/exit`) — test on one session and read back the confirmation before applying to a
fleet.

**Queue work that is cheap to judge.** Small, testable, obviously-right-or-wrong assignments
beat sprawling ones. Agents multiply output, not review capacity — the bottleneck is whoever
has to say yes.

**Escalate real decisions.** When a worker is blocked on something only a human can answer,
surface the question rather than guessing on their behalf.

## Running a worker unattended

A worker on a multi-step roadmap stops after each step and waits. Closing that loop is the whole
game for long-horizon work: poll it, and when it goes idle, either advance it or unblock it.

Pair this with any scheduler — a loop/cron skill, a wakeup timer, or a plain `while` loop.
Poll every ~5 minutes by default: steps typically take 5–20 minutes, so the worker idles a
couple of minutes at most. Go to 1m only when actively watching, 10m+ for long builds or
overnight runs. Prefer `list --id=<id>` on a tick — its payload is fixed-size, while
`list --rc --fresh=30` silently grows with the fleet.

Each tick, branch on `worker`:

- **`running`** — do nothing. Say so in one line and stop.
- **`idle`** — run `status <id>` and decide which case it is:
  - **Step finished** — verify against disk and git log first. Verified → `/clear`, wait ~10s,
    confirm still idle, then send the next assignment **in the same tick**. Splitting those
    across two ticks wastes a whole interval of worker time.
  - **Waiting on a background job** — it ended its turn with a build or suite still running.
    The work is done and only the landing stalled: nudge it to read the result and close out.
    Never `/clear` here, and never skip ahead. If it says the job is still going, wait — it
    cannot block on a background job, so nudging costs a turn and buys nothing.
  - **Stalled mid-step** — send a short nudge naming what's left. Don't `/clear`; the context
    is exactly what it needs.
  - **Blocked on a real decision** — stop and surface the question.

If a `/clear` landed without a follow-up assignment (a tick died mid-way), the next tick sees an
idle session with empty context — just send the assignment.

Stop when the roadmap is exhausted, on a genuine block, or when told to — then report: steps
completed, commits landed, what remains. Report faithfully; if the worker failed tests every
step, say that instead of reporting progress.

## Fleets and nesting

`list --id=<a>,<b>,<c>` returns just those rows in one call, so one tick can poll a whole fleet
for barely more than a single session costs. Keep a per-worker assignment — each has its own
project and definition of done — and run the branch logic independently per row. One loop for
the fleet, not one per worker.

Directors can direct directors. What makes that work:

- **A director's state lives in its recurring prompt, not its context.** If the scheduler
  re-injects the full tick logic every fire, `/clear` is safe on a director too — it wakes with
  no memory and the prompt tells it everything. Same self-containment rule, one level up.
- **A sub-director's charter must name everything**: absolute path to `relay.mjs`, target
  session ids, the roadmap file, the interval, the stop condition.
- **Poll a sub-director slower than it polls its workers** — at least 2–3× its interval, or it
  re-enters its own logic on stale state and double-sends.
- **Never create a cycle.** A drives B drives A is an infinite loop with no human in it. Keep
  the hierarchy a tree; check the target isn't an ancestor before scheduling.
- **A sub-director escalates upward** — `send` to the parent session — rather than surfacing to
  a user who isn't watching that window. Only the top director talks to the human.
- **Distrust the layer below.** "3 steps done" from a sub-director is a claim. Verify against
  the roadmap file or git log; errors compound quietly as the tree deepens.

## Notes and troubleshooting

- One director per worker. Two loops bumping the same session will double-send and race.
- Point at a different credentials file with `CLAUDE_CREDENTIALS=/path/to/.credentials.json`.
- **Slash commands from a POSIX shell on Windows:** a leading `/` in `send` (e.g. `/clear`) gets
  rewritten to a Windows path by MSYS. Prefix `MSYS_NO_PATHCONV=1`, or send from PowerShell.
- **Quoting:** keep sent text free of the quote character wrapping it. In PowerShell a bare `'`
  inside a single-quoted string truncates the rest of the instruction silently.
- 401s can flap on valid tokens; the script retries. A persistent 401 means the token expired —
  run any `claude` command to refresh `~/.claude/.credentials.json`.
- Commit attribution is automatic via the `Claude-Session:` trailer:
  `git log --format='%h %s | %(trailers:key=Claude-Session,valueonly)'` shows which session did
  what. `git log` is the cheap activity feed for finished work; `git diff` for work in flight.
- This drives sessions, not window layout — moving or arranging canvas windows is a separate
  concern.
