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
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { parseDocument, stringify, Scalar, YAMLSeq, YAMLMap } from 'yaml'

const LOCAL_MATCH_FILE = path.join(
  os.homedir(),
  'Library/Application Support/espanso/match/base.yml'
)
const ICLOUD_DIR = path.join(
  os.homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Espanso'
)
const ICLOUD_MATCH_FILE = path.join(ICLOUD_DIR, 'base.yml')

export const MATCH_FILE = process.env.ESPANSO_MATCH_FILE || LOCAL_MATCH_FILE

function isSymlinkTo(linkPath, targetPath) {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return false
    return fs.realpathSync(linkPath) === fs.realpathSync(targetPath)
  } catch {
    return false
  }
}

export function getSyncStatus() {
  const icloudAvailable = fs.existsSync(path.dirname(ICLOUD_DIR)) // ~/Library/Mobile Documents exists
  const icloudFileExists = fs.existsSync(ICLOUD_MATCH_FILE)
  const linked = icloudFileExists && isSymlinkTo(LOCAL_MATCH_FILE, ICLOUD_MATCH_FILE)
  return {
    icloudAvailable,
    icloudFileExists,
    linked,
    localPath: LOCAL_MATCH_FILE,
    icloudPath: ICLOUD_MATCH_FILE,
  }
}

// Turns on iCloud sync: the real file ends up at ICLOUD_MATCH_FILE, with LOCAL_MATCH_FILE
// symlinked to it. Never silently discards existing content — if both a local file and an
// iCloud file already exist with different content, the local one is backed up first.
export function enableSync() {
  const status = getSyncStatus()
  if (status.linked) return status

  fs.mkdirSync(ICLOUD_DIR, { recursive: true })

  const localStat = fs.existsSync(LOCAL_MATCH_FILE) ? fs.lstatSync(LOCAL_MATCH_FILE) : null
  const localIsRealFile = localStat && !localStat.isSymbolicLink()

  if (!status.icloudFileExists) {
    // First Mac to enable sync: move the existing local file up to iCloud.
    if (localIsRealFile) {
      fs.copyFileSync(LOCAL_MATCH_FILE, ICLOUD_MATCH_FILE)
    } else {
      fs.writeFileSync(ICLOUD_MATCH_FILE, 'matches: []\n', 'utf8')
    }
  } else if (localIsRealFile) {
    // Another Mac already set up sync. If this Mac's local file has different content
    // (e.g. its own snippets), back it up instead of silently overwriting it.
    const localText = fs.readFileSync(LOCAL_MATCH_FILE, 'utf8')
    const icloudText = fs.readFileSync(ICLOUD_MATCH_FILE, 'utf8')
    if (localText !== icloudText) {
      const backupPath = `${LOCAL_MATCH_FILE}.backup-${Date.now()}`
      fs.copyFileSync(LOCAL_MATCH_FILE, backupPath)
    }
  }

  if (localStat) fs.rmSync(LOCAL_MATCH_FILE, { force: true })
  fs.mkdirSync(path.dirname(LOCAL_MATCH_FILE), { recursive: true })
  fs.symlinkSync(ICLOUD_MATCH_FILE, LOCAL_MATCH_FILE)

  return getSyncStatus()
}

// Turns off iCloud sync: copies the current (iCloud) content back down into a real local
// file and removes the symlink. The iCloud copy is left untouched.
export function disableSync() {
  const status = getSyncStatus()
  if (!status.linked) return status

  const text = fs.readFileSync(LOCAL_MATCH_FILE, 'utf8')
  fs.rmSync(LOCAL_MATCH_FILE, { force: true })
  fs.writeFileSync(LOCAL_MATCH_FILE, text, 'utf8')

  return getSyncStatus()
}

// Fields our structured UI understands. Anything else on an entry makes it "advanced".
const SIMPLE_KEYS = new Set(['trigger', 'triggers', 'replace', 'label', 'word', 'propagate_case'])

function strScalar(value) {
  const s = new Scalar(String(value))
  s.type = Scalar.QUOTE_DOUBLE
  return s
}

const EMPTY_SCAFFOLD = '# Espanso match file — managed by Espanso Manager\n# https://espanso.org/docs/\n\nmatches: []\n'

function loadDoc() {
  let text
  try {
    text = fs.readFileSync(MATCH_FILE, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      // No match file yet (fresh Espanso install, or a custom path). Start from an
      // empty scaffold rather than crashing with a cryptic ENOENT.
      text = EMPTY_SCAFFOLD
    } else {
      throw err
    }
  }
  return parseDocument(text, { keepSourceTokens: true })
}

// Resolve a path through any symlink to its real target, so we write to the actual file
// (e.g. the iCloud copy) instead of replacing the symlink Espanso reads through.
function resolveRealTarget(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

// Write atomically: write a temp file in the target's directory, then rename over the
// target. rename() within one filesystem is atomic, so Espanso (which watches the file)
// never sees a half-written / truncated base.yml, even if we crash mid-write.
function writeFileAtomic(targetPath, text) {
  const real = resolveRealTarget(targetPath)
  const dir = path.dirname(real)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(real)}.tmp-${process.pid}`)
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, real)
}

function saveDoc(doc) {
  writeFileAtomic(MATCH_FILE, doc.toString())
  reloadEspanso()
}

// Locate the espanso binary. A GUI-launched app has a minimal PATH, so we probe the
// usual install locations rather than relying on PATH.
export function findEspanso() {
  const candidates = [
    '/usr/local/bin/espanso',
    '/opt/homebrew/bin/espanso',
    '/Applications/Espanso.app/Contents/MacOS/espanso',
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

// Espanso doesn't reliably auto-detect edits made through the iCloud symlink, so we nudge
// it to reload after a change. Debounced (rapid successive saves collapse into one reload)
// and best-effort (never throws, never blocks the save).
let reloadTimer = null
function reloadEspanso() {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    const bin = findEspanso()
    if (!bin) return
    try {
      const child = spawn(bin, ['service', 'restart'], { detached: true, stdio: 'ignore' })
      child.unref()
    } catch {
      /* best-effort */
    }
  }, 600)
}

function getMatchesSeq(doc) {
  let seq = doc.get('matches', true)
  if (!seq) {
    seq = new YAMLSeq()
    doc.set('matches', seq)
  }
  if (!(seq instanceof YAMLSeq)) {
    throw new Error('The "matches" key in base.yml is not a list — please fix the file manually.')
  }
  return seq
}

function isSimple(obj) {
  const keys = Object.keys(obj)
  if (keys.length === 0) return false
  if (!keys.every((k) => SIMPLE_KEYS.has(k))) return false
  if (!obj.trigger && !obj.triggers) return false
  if (typeof obj.replace !== 'string') return false
  return true
}

function itemToView(itemNode, index) {
  const obj = itemNode.toJSON()
  return {
    id: index,
    simple: isSimple(obj),
    trigger: obj.trigger ?? null,
    triggers: obj.triggers ?? null,
    replace: obj.replace ?? '',
    label: obj.label ?? '',
    word: !!obj.word,
    propagate_case: !!obj.propagate_case,
    raw: stringifyItem(itemNode),
  }
}

function stringifyItem(itemNode) {
  // Render just this one match entry as a standalone YAML mapping for the raw editor.
  return stringify(itemNode).trimEnd()
}

export function listMatches() {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  return seq.items.map((item, i) => itemToView(item, i))
}

function buildEntryNode({ trigger, triggers, replace, label, word, propagate_case }) {
  const map = new YAMLMap()
  if (Array.isArray(triggers) && triggers.length > 1) {
    const seq = new YAMLSeq()
    triggers.forEach((t) => seq.items.push(strScalar(t)))
    map.set('triggers', seq)
  } else {
    const t = Array.isArray(triggers) ? triggers[0] : trigger
    map.set('trigger', strScalar(t))
  }
  map.set('replace', strScalar(replace))
  if (label) map.set('label', strScalar(label))
  if (word) map.set('word', true)
  if (propagate_case) map.set('propagate_case', true)
  return map
}

export function createMatch(fields) {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  seq.items.push(buildEntryNode(fields))
  saveDoc(doc)
  return listMatches()
}

export function updateMatch(id, fields) {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  if (id < 0 || id >= seq.items.length) throw new Error('Snippet not found')
  seq.items[id] = buildEntryNode(fields)
  saveDoc(doc)
  return listMatches()
}

export function updateMatchRaw(id, rawYaml) {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  if (id < 0 || id >= seq.items.length) throw new Error('Snippet not found')
  const parsed = parseDocument(rawYaml)
  if (parsed.errors.length) throw new Error('Invalid YAML: ' + parsed.errors[0].message)
  const node = parsed.contents
  if (!(node instanceof YAMLMap)) throw new Error('A snippet must be a YAML mapping (key: value pairs)')
  seq.items[id] = node
  saveDoc(doc)
  return listMatches()
}

export function createMatchRaw(rawYaml) {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  const parsed = parseDocument(rawYaml)
  if (parsed.errors.length) throw new Error('Invalid YAML: ' + parsed.errors[0].message)
  const node = parsed.contents
  if (!(node instanceof YAMLMap)) throw new Error('A snippet must be a YAML mapping (key: value pairs)')
  seq.items.push(node)
  saveDoc(doc)
  return listMatches()
}

export function deleteMatch(id) {
  const doc = loadDoc()
  const seq = getMatchesSeq(doc)
  if (id < 0 || id >= seq.items.length) throw new Error('Snippet not found')
  seq.items.splice(id, 1)
  saveDoc(doc)
  return listMatches()
}
