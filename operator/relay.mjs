#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import https from 'node:https'
import { join } from 'node:path'

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
    return {
      id: s.id || s.session_id,
      title: s.title || s.name || s.summary || '',
      remoteControl: (s.tags || []).includes('remote-control-auto'),
      worker: s.worker_status || '',
      bucket: s.status_bucket || s.status || '',
      status: s.status || '',
      connection: s.connection_status || '',
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
    } else if (cmd === 'send') {
      const id = rest[0]
      const text = rest.slice(1).join(' ')
      if (!id || !text) throw new Error('usage: relay.mjs send <sessionId> <text...>')
      await send(id, text)
      console.log('sent')
    } else {
      console.log('usage: relay.mjs <list [--rc] [--fresh[=min]] [--id=<id>[,<id>]] | live [min] | read <id> [tail] [--assistant] | status <id> [tail] | send <id> <text...>>')
      process.exit(cmd ? 1 : 0)
    }
  } catch (e) {
    console.error('Error: ' + e.message)
    process.exit(1)
  }
}

main()
