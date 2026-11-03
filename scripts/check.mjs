// Local stand-in for `orca plugin validate` (the installed CLI has no `plugin` command):
// checks the rules from Orca's plugin-themes.md / plugin-theme-tokens.md that a data theme can break.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const errors = []
const fail = (m) => errors.push(m)

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const KNOWN_TOKENS = new Set(`--background --editor-surface --foreground --card --card-foreground --popover
--popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted
--muted-foreground --accent --accent-foreground --border --input --ring --chart-1 --chart-2 --chart-3
--chart-4 --chart-5 --sidebar --sidebar-foreground --sidebar-primary --sidebar-primary-foreground
--sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring --worktree-sidebar
--worktree-sidebar-foreground --worktree-sidebar-accent --worktree-sidebar-accent-foreground
--worktree-sidebar-border --worktree-sidebar-ring --worktree-sidebar-active --worktree-sidebar-active-border
--host-badge --host-badge-foreground --tab-bar --tab-active --tab-active-foreground --tab-active-indicator
--tab-inactive --tab-inactive-foreground --split-divider --split-divider-hover --chat-user-message --text-link
--diff-added --diff-added-background --diff-added-emphasis --diff-added-gutter --diff-removed
--diff-removed-background --diff-removed-emphasis --diff-removed-gutter --git-decoration-added
--git-decoration-modified --git-decoration-deleted --git-decoration-renamed --git-decoration-untracked
--git-decoration-copied --git-decoration-ignored`.split(/\s+/))

const manifest = read('orca-plugin.json')
if (manifest.manifestVersion !== 2) fail('manifestVersion must be 2')
if (manifest.execution !== 'data') fail('execution must be "data"')
if (!manifest.publisher) fail('publisher is required before Orca 1.4.246')
if (/^orca/i.test(manifest.publisher) || manifest.id.startsWith('orca-')) fail('orca* publisher / orca- id are reserved for the official catalog')
for (const [family, list] of Object.entries(manifest.contributes)) {
  for (const entry of list) {
    const size = statSync(join(root, entry.path)).size
    if (size > 16 * 1024) fail(`${entry.path}: ${size} bytes exceeds 16 KiB`)
  }
}

const theme = read('themes/palenight.json')
const t = theme.tokens
for (const k of Object.keys(t)) {
  if (!KNOWN_TOKENS.has(k)) fail(`unknown token ${k}`)
  if (!HEX.test(t[k])) fail(`${k}: not a 6-digit hex color`)
}
for (const k of ['--background', '--foreground']) if (!t[k]) fail(`${k} is required`)

// Text/surface pairs must reach 4.5:1 or Orca drops BOTH colors of the pair (a failing
// --background/--muted-foreground pair silently turns the app canvas back into Orca's default black).
const pairs = [['--background', '--foreground'], ['--background', '--muted-foreground'],
  ['--editor-surface', '--foreground'], ['--editor-surface', '--muted-foreground'], ['--tab-inactive', '--tab-active-foreground'], ['--card', '--card-foreground'], ['--popover', '--popover-foreground'],
  ['--primary', '--primary-foreground'], ['--secondary', '--secondary-foreground'], ['--muted', '--muted-foreground'],
  ['--accent', '--accent-foreground'], ['--sidebar', '--sidebar-foreground'],
  ['--sidebar-primary', '--sidebar-primary-foreground'], ['--sidebar-accent', '--sidebar-accent-foreground'],
  ['--tab-active', '--tab-active-foreground'], ['--tab-inactive', '--tab-inactive-foreground'],
  ['--host-badge', '--host-badge-foreground']]
for (const [surface, text] of pairs) {
  if (!t[surface] || !t[text]) continue
  const ratio = contrast(t[surface], t[text])
  if (ratio < 4.5) fail(`${text} on ${surface}: ${ratio.toFixed(2)} < 4.5`)
}

// Orca drops these when they fall under 3:1 on their surface (or are translucent).
for (const [surface, text] of [['--editor-surface', '--text-link'], ...['added', 'modified', 'deleted', 'renamed', 'untracked', 'copied', 'ignored'].map((n) => ['--sidebar', `--git-decoration-${n}`])]) {
  if (!t[text]) continue
  if (t[text].length !== 7) fail(`${text}: must be opaque`)
  else if (contrast(t[surface], t[text]) < 3) fail(`${text} on ${surface}: ${contrast(t[surface], t[text]).toFixed(2)} < 3`)
}
if (contrast(t['--tab-active'], t['--tab-active-indicator']) < 2) fail('--tab-active-indicator on --tab-active < 2')

// Code colors under 3:1 against the editor background are dropped.
const editorBg = t['--editor-surface'] ?? t['--background']
for (const rule of theme.tokenColors) {
  if (!rule.scope) fail('tokenColors entry without scope')
  const fg = rule.settings.foreground
  if (!fg) continue
  const ratio = contrast(editorBg, fg)
  if (ratio < 3) fail(`${JSON.stringify(rule.scope)} ${fg}: ${ratio.toFixed(2)} < 3 (would be dropped)`)
}

const term = read('terminal/palenight.json').terminal
for (const [k, v] of Object.entries(term)) if (!HEX.test(v)) fail(`terminal.${k}: not hex`)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('ok')
