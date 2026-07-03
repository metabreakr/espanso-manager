// Espanso Manager — Copyright (C) 2026 Jonathan Ruzek
// SPDX-License-Identifier: GPL-3.0-only
// Smoke tests for the YAML store. Run with: npm test
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Point the store at a throwaway match file BEFORE importing it (it reads the path at import).
const tmpFile = path.join(os.tmpdir(), `espanso-manager-test-${process.pid}.yml`)
fs.writeFileSync(
  tmpFile,
  '# my snippets header comment\nmatches:\n  - trigger: ":hi"\n    replace: "hello"\n'
)
process.env.ESPANSO_MATCH_FILE = tmpFile

const store = await import('./store.mjs')

after(() => {
  try { fs.unlinkSync(tmpFile) } catch {}
})

test('lists existing matches', () => {
  const list = store.listMatches()
  assert.equal(list.length, 1)
  assert.equal(list[0].trigger, ':hi')
  assert.equal(list[0].simple, true)
})

test('creating a snippet preserves file comments', () => {
  store.createMatch({ trigger: ':bye', replace: 'goodbye' })
  const text = fs.readFileSync(tmpFile, 'utf8')
  assert.match(text, /# my snippets header comment/)
  assert.equal(store.listMatches().length, 2)
})

test('multi-trigger round-trips as a triggers list', () => {
  store.createMatch({ triggers: [':a', ':b'], replace: 'x' })
  const m = store.listMatches().find((s) => s.triggers)
  assert.deepEqual(m.triggers, [':a', ':b'])
})

test('update then delete', () => {
  store.updateMatch(0, { trigger: ':hi', replace: 'HELLO' })
  assert.equal(store.listMatches()[0].replace, 'HELLO')
  const before = store.listMatches().length
  store.deleteMatch(0)
  assert.equal(store.listMatches().length, before - 1)
})

test('values that look like numbers stay strings', () => {
  store.createMatch({ trigger: ':ver', replace: 'v2', label: '123' })
  const text = fs.readFileSync(tmpFile, 'utf8')
  // label must be quoted so YAML keeps it a string, not the integer 123.
  assert.match(text, /label: "123"/)
})

test('entries with unknown keys are flagged advanced', () => {
  store.createMatchRaw('trigger: ":dyn"\nreplace: "{{out}}"\nvars:\n  - name: out\n    type: date')
  const adv = store.listMatches().find((s) => s.trigger === ':dyn')
  assert.equal(adv.simple, false)
})

test('createMatches imports many and skips invalid rows', () => {
  const before = store.listMatches().length
  const res = store.createMatches([
    { trigger: ';i1', replace: 'one', label: 'L1' },
    { trigger: ';i2', replace: 'two' },
    { trigger: '', replace: 'no trigger' }, // skipped
  ])
  assert.equal(res.count, 2)
  assert.equal(store.listMatches().length, before + 2)
})

test('deleteMatches removes multiple by index safely', () => {
  const list = store.listMatches()
  const ids = [list.length - 1, list.length - 2] // last two
  const before = list.length
  const res = store.deleteMatches(ids)
  assert.equal(res.count, 2)
  assert.equal(store.listMatches().length, before - 2)
})
