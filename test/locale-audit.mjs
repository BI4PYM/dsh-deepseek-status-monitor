// Locale consistency audit for the browser half. Not part of the shipped bundle.
//   node test/locale-audit.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const zhStart = source.indexOf('    const zh = {')
const enStart = source.indexOf('    const en = {')
const localeEnd = source.indexOf('    // --- locale')
if (zhStart < 0 || enStart < 0 || localeEnd < 0) throw new Error('cannot locate the dictionaries')

function keysOf(block) {
  const keys = new Set()
  for (const match of block.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1])
  return keys
}

const zh = keysOf(source.slice(zhStart, enStart))
const en = keysOf(source.slice(enStart, localeEnd))
const problems = []

if (zh.size !== en.size) problems.push(`dictionary size differs: zh ${zh.size}, en ${en.size}`)
for (const key of zh) if (!en.has(key)) problems.push(`missing in en: ${key}`)
for (const key of en) if (!zh.has(key)) problems.push(`missing in zh: ${key}`)

// Every literal key passed to t('...') must exist in both dictionaries. Keys
// built with a template literal (settings.position.${value}) are checked against
// the fixed value sets below.
const used = new Set()
for (const match of source.matchAll(/\bt\('([^']+)'/g)) used.add(match[1])
for (const position of ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'top', 'bottom']) {
  used.add(`settings.position.${position}`)
}
for (const key of used) {
  if (!zh.has(key)) problems.push(`used key missing in zh: ${key}`)
  if (!en.has(key)) problems.push(`used key missing in en: ${key}`)
}

// Every dictionary key should be reachable: 'a.b' matches t('a.b'); keys with a
// dynamic suffix are allow-listed.
const dynamicPrefixes = ['settings.position.']
const unused = [...zh].filter(
  (key) =>
    !source.includes(`'${key}'`) ||
    (!used.has(key) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix))),
)

console.log(JSON.stringify({ zh: zh.size, en: en.size, used: used.size, problems, unused }, null, 2))
if (problems.length > 0) process.exitCode = 1
