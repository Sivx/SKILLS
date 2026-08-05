#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import https from 'node:https'
import { spawn as spawnProc } from 'node:child_process'
import { join, resolve, basename } from 'node:path'

const HOST = 'api.anthropic.com'
const VERSION = '2023-06-01'
const credPath = process.env.CLAUDE_CREDENTIALS || join(os.homedir(), '.claude', '.credentials.json')

function accessToken() {
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  const c = raw.claudeAiOauth || raw
  if (!c.accessToken) throw new Error('no accessToken in ' + credPath)
  return c.accessToken
}

const delay = ms => new Promise(r => setTimeout(r, ms))

function once(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null
    const headers = {
      Authorization: 'Bearer ' + accessToken(),
      'anthropic-version': VERSION,
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    }
    const req = https.request({ host: HOST, path, method, headers, timeout: 15000 }, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const e = new Error(`relay HTTP ${res.statusCode}: ${d.slice(0, 300)}`)
          e.status = res.statusCode
          return reject(e)
        }
        if (!d) return resolve(null)
        try { resolve(JSON.parse(d)) } catch { resolve(d) }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`relay ${method} timed out`)))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function request(method, path, body) {
  const flappy = s => s === 401 || s === 429 || s == null || s >= 500
  let lastErr
  for (const wait of [0, 400, 900, 2000]) {
    if (wait) await delay(wait)
    try { return await once(method, path, body) } catch (e) {
      lastErr = e
      if (e.status != null && !flappy(e.status)) throw e
    }
  }
  throw lastErr
}

const enc = encodeURIComponent

function toolResultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(b => (typeof b === 'string' ? b : b?.text || '')).join('')
  return ''
}

function eventsToText(res, { assistantOnly = false } = {}) {
  const evs = Array.isArray(res?.data) ? res.data : []
  const chrono = [...evs].reverse()
  const lines = []
  for (const ev of chrono) {
    const type = ev?.event_type
    if (type !== 'user' && type !== 'assistant') continue
    if (assistantOnly && type !== 'assistant') continue
    const content = ev.payload?.message?.content
    if (typeof content === 'string') {
      if (content.trim()) lines.push(`[${type}] ${content.trim()}`)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type === 'text' && b.text?.trim()) lines.push(`[${type}] ${b.text.trim()}`)
      else if (assistantOnly) continue
      else if (b?.type === 'tool_use') {
        const arg = b.input?.command || b.input?.file_path || b.input?.path || b.input?.pattern || ''
        lines.push(`[tool: ${b.name || 'tool'}] ${String(arg).slice(0, 200)}`)
      } else if (b?.type === 'tool_result') {
        const text = toolResultText(b.content)
        if (text.trim()) lines.push(`[result${b.is_error ? ' error' : ''}] ${text.trim().slice(0, 500)}`)
      }
    }
  }
  return lines.join('\n')
}

function ageMinutes(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60000)
}

async function list({ rcOnly = false, freshMin = null, ids = null } = {}) {
  const j = await request('GET', '/v1/code/sessions?limit=100')
  const arr = j?.data || j?.sessions || []
  let rows = arr.map(s => {
    const age = ageMinutes(s.last_event_at)
    // The worker's own end-of-turn self-report. `needs_action` is the cheapest
    // signal that a session is waiting on something rather than just done.
    const sum = s.external_metadata?.post_turn_summary || null
    return {
      id: s.id || s.session_id,
      title: s.title || s.name || s.summary || '',
      remoteControl: (s.tags || []).includes('remote-control-auto'),
      worker: s.worker_status || '',
      bucket: s.status_bucket || s.status || '',
      status: s.status || '',
      connection: s.connection_status || '',
      repo: s.config?.outcomes?.find(o => o.git_info)?.git_info?.repo || '',
      need: sum?.status_category || '',
      detail: sum?.status_detail || '',
      needsAction: sum?.needs_action || '',
      ageMin: age,
      lastEventAt: s.last_event_at || '',
      live: s.connection_status === 'connected' && age != null && age < 15,
    }
  })
  rows = rows.filter(r => r.status !== 'archived')
  if (ids) rows = rows.filter(r => ids.includes(r.id))
  if (rcOnly) rows = rows.filter(r => r.remoteControl)
  // An explicitly named id always shows, however stale — you asked for it by name.
  if (freshMin != null && !ids) rows = rows.filter(r => r.ageMin != null && r.ageMin <= freshMin)
  rows.sort((a, b) => (a.ageMin ?? Infinity) - (b.ageMin ?? Infinity))
  return rows
}

async function read(id, tail = 4000, { assistantOnly = false } = {}) {
  const res = await request('GET', `/v1/code/sessions/${enc(id)}/events?limit=200`)
  return eventsToText(res, { assistantOnly }).slice(-tail)
}

// One-call answer to "what is this session doing?" — the list row plus the last
// thing it actually said, with the tool-call noise stripped. This is what a
// polling loop wants on an idle tick; `list --id` is enough on a busy one.
async function status(id, tail = 1200) {
  const [row] = await list({ ids: [id] })
  if (!row) return { id, error: 'not found' }
  return { ...row, lastAssistant: await read(id, tail, { assistantOnly: true }) }
}

// Launch a new Claude Code session in `cwd` and return its relay id.
//
// Identity is solved at the source: `claude --remote-control <name>` lets us choose
// the session's name up front, so we look for exactly that title instead of guessing
// which new row is ours. The before/after id diff is the fallback for the case where
// the name doesn't survive to the relay.
//
// `claude` is an interactive TUI and needs a real TTY — with no console it detects
// non-interactive and exits before it ever reaches the relay. So every strategy below
// gives it a terminal.
function launchStrategy(cwd, name, model) {
  const bin = process.env.CLAUDE_BIN || 'claude'
  const flags = ['--remote-control', name, ...(model ? ['--model', model] : [])]
  const q = s => `"${String(s).replace(/"/g, '""')}"`
  if (process.platform === 'win32') {
    // `start` gives a real console; /D sets the working directory.
    return { cmd: `start "" /D ${q(cwd)} ${q(bin)} ${flags.map(q).join(' ')}`, shell: true }
  }
  if (process.platform === 'darwin') {
    const inner = `cd ${q(cwd)} && ${bin} ${flags.map(q).join(' ')}`
    return { cmd: `osascript -e 'tell application "Terminal" to do script ${JSON.stringify(inner)}'`, shell: true }
  }
  // Linux: `script` hands us a pty without pulling in a native dependency, so this
  // works headless over ssh as well as on a desktop.
  const inner = `${bin} ${flags.map(q).join(' ')}`
  return { cmd: `setsid script -qc ${q(inner)} /dev/null`, shell: true, cwd }
}

async function spawnSession(cwdArg, { name: wanted, prompt, model, timeoutMs = 60000 } = {}) {
  const cwd = resolve(cwdArg)
  if (!fs.existsSync(cwd)) throw new Error(`no such directory: ${cwd}`)
  const name = wanted || `op-${basename(cwd)}-${Date.now().toString(36).slice(-4)}`

  const before = new Set((await list({})).map(r => r.id))
  const { cmd, shell, cwd: procCwd } = launchStrategy(cwd, name, model)
  const child = spawnProc(cmd, { cwd: procCwd || cwd, shell, detached: true, stdio: 'ignore' })
  child.unref()

  const deadline = Date.now() + timeoutMs
  let row = null
  while (Date.now() < deadline) {
    await delay(2000)
    const rows = await list({})
    row = rows.find(r => r.title === name) || rows.find(r => !before.has(r.id)) || null
    if (row) break
  }
  if (!row) throw new Error(`session did not register within ${Math.round(timeoutMs / 1000)}s (name: ${name})`)

  if (prompt) {
    // Give the TUI a moment to finish coming up before the first turn lands.
    await delay(3000)
    await send(row.id, prompt)
  }
  return { id: row.id, name, cwd, prompted: Boolean(prompt) }
}

function send(id, text) {
  return request('POST', `/v1/code/sessions/${enc(id)}/events`, {
    events: [{ event_type: 'user', payload: { type: 'user', message: { role: 'user', content: String(text) } } }],
  })
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    if (cmd === 'list') {
      const rcOnly = rest.includes('--rc')
      const freshArg = rest.find(a => /^--fresh(=\d+)?$/.test(a))
      const freshMin = freshArg ? Number(freshArg.split('=')[1] || 60) : null
      const idArgs = rest.filter(a => a.startsWith('--id=')).map(a => a.slice(5))
      const ids = idArgs.length ? idArgs.flatMap(a => a.split(',')).filter(Boolean) : null
      console.log(JSON.stringify(await list({ rcOnly, freshMin, ids }), null, 2))
    } else if (cmd === 'live') {
      const min = rest[0] ? Number(rest[0]) : 30
      const rows = await list({ rcOnly: true, freshMin: min })
      console.log(JSON.stringify(rows, null, 2))
      console.error(`${rows.length} remote-control session(s) with activity in the last ${min}m`)
    } else if (cmd === 'read') {
      const assistantOnly = rest.includes('--assistant')
      const [id, tail] = rest.filter(a => !a.startsWith('--'))
      if (!id) throw new Error('usage: relay.mjs read <sessionId> [tailChars] [--assistant]')
      console.log(await read(id, tail ? Number(tail) : 4000, { assistantOnly }))
    } else if (cmd === 'status') {
      const [id, tail] = rest.filter(a => !a.startsWith('--'))
      if (!id) throw new Error('usage: relay.mjs status <sessionId> [tailChars]')
      console.log(JSON.stringify(await status(id, tail ? Number(tail) : 1200), null, 2))
    } else if (cmd === 'spawn') {
      const flag = (n) => { const a = rest.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null }
      const cwdArg = rest.find(a => !a.startsWith('--'))
      if (!cwdArg) throw new Error('usage: relay.mjs spawn <cwd> [--name=<name>] [--model=<model>] [--prompt=<text>]')
      console.log(JSON.stringify(await spawnSession(cwdArg, {
        name: flag('name'), model: flag('model'), prompt: flag('prompt'),
      }), null, 2))
    } else if (cmd === 'send') {
      const id = rest[0]
      const text = rest.slice(1).join(' ')
      if (!id || !text) throw new Error('usage: relay.mjs send <sessionId> <text...>')
      await send(id, text)
      console.log('sent')
    } else {
      console.log('usage: relay.mjs <list [--rc] [--fresh[=min]] [--id=<id>[,<id>]] | live [min] | read <id> [tail] [--assistant] | status <id> [tail] | spawn <cwd> [--name=] [--model=] [--prompt=] | send <id> <text...>>')
      process.exit(cmd ? 1 : 0)
    }
  } catch (e) {
    console.error('Error: ' + e.message)
    process.exit(1)
  }
}

main()
