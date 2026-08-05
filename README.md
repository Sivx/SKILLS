# SKILLS

Canonical `CLAUDE.md` (and skills) served over HTTPS. Start a new project, pull the latest
copy from `main`, and the session is configured.

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
