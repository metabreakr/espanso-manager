/*
 * Espanso Manager
 * Copyright (C) 2026 Jonathan Ruzek
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License version 3, as published by the Free
 * Software Foundation. It is distributed WITHOUT ANY WARRANTY; see the LICENSE
 * file or <https://www.gnu.org/licenses/> for details.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as store from './store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT || process.env.ESPANSO_MANAGER_PORT) || 8934

// App version + GitHub repo (for the About screen and update checks).
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
const VERSION = pkg.version
const REPO = 'metabreakr/espanso-manager'

// Compare two dotted numeric versions; returns >0 if a is newer than b.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

async function checkForUpdates() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'espanso-manager' },
  })
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  const data = await res.json()
  const latest = String(data.tag_name || '').replace(/^v/, '')
  return {
    current: VERSION,
    latest,
    url: data.html_url || `https://github.com/${REPO}/releases`,
    updateAvailable: !!latest && compareVersions(latest, VERSION) > 0,
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 5_000_000) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  const { method } = req
  const p = url.pathname
  const parts = p.split('/').filter(Boolean) // e.g. ['api', 'snippets', '2']
  try {
    let data
    if (method === 'GET' && p === '/api/meta') {
      data = { matchFile: store.MATCH_FILE, espansoReload: !!store.findEspanso(), version: VERSION, repo: REPO }
    } else if (method === 'GET' && p === '/api/update-check') {
      data = await checkForUpdates()
    } else if (method === 'GET' && p === '/api/snippets') {
      data = store.listMatches()
    } else if (method === 'POST' && p === '/api/snippets/import') {
      const { snippets } = await readJsonBody(req)
      data = store.createMatches(snippets)
    } else if (method === 'POST' && p === '/api/snippets/bulk-delete') {
      const { ids } = await readJsonBody(req)
      data = store.deleteMatches(ids)
    } else if (method === 'POST' && p === '/api/snippets') {
      const { raw, ...fields } = await readJsonBody(req)
      data = raw ? store.createMatchRaw(raw) : store.createMatch(fields)
    } else if (method === 'PUT' && parts[0] === 'api' && parts[1] === 'snippets' && parts[2] !== undefined) {
      const { raw, ...fields } = await readJsonBody(req)
      data = raw !== undefined ? store.updateMatchRaw(Number(parts[2]), raw) : store.updateMatch(Number(parts[2]), fields)
    } else if (method === 'DELETE' && parts[0] === 'api' && parts[1] === 'snippets' && parts[2] !== undefined) {
      data = store.deleteMatch(Number(parts[2]))
    } else if (method === 'GET' && p === '/api/sync') {
      data = store.getSyncStatus()
    } else if (method === 'POST' && p === '/api/sync/enable') {
      data = store.enableSync()
    } else if (method === 'POST' && p === '/api/sync/disable') {
      data = store.disableSync()
    } else if (method === 'POST' && p === '/api/restore') {
      const { useDefault } = await readJsonBody(req)
      data = store.restoreLocal(!!useDefault)
    } else {
      return sendJson(res, 404, { ok: false, error: 'Not found' })
    }
    sendJson(res, 200, { ok: true, data })
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message })
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/') rel = '/index.html'
  const filePath = path.join(PUBLIC_DIR, rel)
  // Guard against path traversal: the resolved path must stay inside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' })
    res.end(buf)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`)
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url)
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url)
  } else {
    res.writeHead(405)
    res.end('Method Not Allowed')
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close whatever is using it, or set PORT to a free port.`)
  } else {
    console.error(err)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`Espanso Manager running at http://${HOST}:${PORT}`)
  console.log(`Editing: ${store.MATCH_FILE}`)
})
