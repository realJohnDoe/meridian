/**
 * Codemod: convert relative parent imports (../) to @/ alias imports.
 * Same-directory (./) imports are left unchanged.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, relative, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(__dirname, '..', 'src')

function walk(dir) {
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

// Matches: from '../...', from "../../...", import('../...'), etc.
// Group 1: quote char, Group 2: the module specifier
const IMPORT_RE = /\b(from\s+|import\s*\()(['"])(\.\.\/[^'"]+)\2/g

let totalFiles = 0
let changedFiles = 0
let totalReplacements = 0

for (const file of walk(SRC_DIR)) {
  const original = readFileSync(file, 'utf8')
  const fileDir = dirname(file)

  let changed = false
  const updated = original.replace(IMPORT_RE, (match, prefix, quote, spec) => {
    // Resolve the relative specifier to an absolute path
    const abs = resolve(fileDir, spec)
    // Make it relative to src/
    const fromSrc = relative(SRC_DIR, abs).replace(/\\/g, '/')
    // Guard: if it goes outside src/ (shouldn't happen), leave it alone
    if (fromSrc.startsWith('..')) return match
    const aliased = `@/${fromSrc}`
    changed = true
    totalReplacements++
    return `${prefix}${quote}${aliased}${quote}`
  })

  totalFiles++
  if (changed) {
    writeFileSync(file, updated, 'utf8')
    changedFiles++
    console.log(`  fixed: ${relative(SRC_DIR, file).replace(/\\/g, '/')}`)
  }
}

console.log(`\nDone. ${changedFiles}/${totalFiles} files changed, ${totalReplacements} replacements.`)
