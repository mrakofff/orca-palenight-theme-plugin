// Local stand-in for `orca plugin validate` (the installed CLI has no `plugin` command).
// Checks the rules from Orca's plugin-themes.md / plugin-theme-tokens.md that a data theme can break,
// plus how Orca derives chat colors, which Orca itself never checks.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const MAX_FILE_BYTES = 16 * 1024
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i
const OPAQUE_HEX = /^#[0-9a-f]{6}$/i

// Minimum WCAG contrast ratios, taken from Orca's renderer.
const TEXT_CONTRAST = 4.5 // text on its surface; a failing pair drops BOTH colors
const ACCENT_CONTRAST = 3 // links, git-status colors, code colors
const INDICATOR_CONTRAST = 2 // active-tab indicator

// Orca's own chat derivation: share of the source color mixed into the canvas.
const CHAT = { canvasFg: 0.05, text: 0.78, strong: 0.9, faint: 0.83 }

const KNOWN_TOKENS = new Set([
  '--background', '--editor-surface', '--foreground',
  '--card', '--card-foreground', '--popover', '--popover-foreground',
  '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground', '--accent', '--accent-foreground',
  '--border', '--input', '--ring',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground',
  '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring',
  '--worktree-sidebar', '--worktree-sidebar-foreground', '--worktree-sidebar-accent', '--worktree-sidebar-accent-foreground',
  '--worktree-sidebar-border', '--worktree-sidebar-ring', '--worktree-sidebar-active', '--worktree-sidebar-active-border',
  '--host-badge', '--host-badge-foreground',
  '--tab-bar', '--tab-active', '--tab-active-foreground', '--tab-active-indicator',
  '--tab-inactive', '--tab-inactive-foreground', '--split-divider', '--split-divider-hover',
  '--chat-user-message', '--text-link',
  '--diff-added', '--diff-added-background', '--diff-added-emphasis', '--diff-added-gutter',
  '--diff-removed', '--diff-removed-background', '--diff-removed-emphasis', '--diff-removed-gutter',
  '--git-decoration-added', '--git-decoration-modified', '--git-decoration-deleted', '--git-decoration-renamed',
  '--git-decoration-untracked', '--git-decoration-copied', '--git-decoration-ignored',
])

// [surface, text]: needs TEXT_CONTRAST. A failing --background/--muted-foreground pair silently
// turns the app canvas back into Orca's default black.
const TEXT_PAIRS = [
  ['--background', '--foreground'],
  ['--background', '--muted-foreground'],
  ['--editor-surface', '--foreground'],
  ['--editor-surface', '--muted-foreground'],
  ['--card', '--card-foreground'],
  ['--popover', '--popover-foreground'],
  ['--primary', '--primary-foreground'],
  ['--secondary', '--secondary-foreground'],
  ['--muted', '--muted-foreground'],
  ['--accent', '--accent-foreground'],
  ['--sidebar', '--sidebar-foreground'],
  ['--sidebar-primary', '--sidebar-primary-foreground'],
  ['--sidebar-accent', '--sidebar-accent-foreground'],
  ['--tab-active', '--tab-active-foreground'],
  ['--tab-inactive', '--tab-active-foreground'],
  ['--tab-inactive', '--tab-inactive-foreground'],
  ['--host-badge', '--host-badge-foreground'],
]

const GIT_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'untracked', 'copied', 'ignored']

// [surface, color]: needs ACCENT_CONTRAST and must be opaque, or Orca drops the color.
const ACCENT_PAIRS = [
  ['--editor-surface', '--text-link'],
  ...GIT_STATUSES.map((status) => ['--sidebar', `--git-decoration-${status}`]),
]

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

// --- color math -------------------------------------------------------------------------------

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function luminance(hex) {
  const [r, g, b] = channels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// `share` of `color` over `base`, as CSS color-mix(in srgb) would produce it.
function mix(color, share, base) {
  const [c, b] = [channels(color), channels(base)]
  const mixed = c.map((v, i) => Math.round(v * share + b[i] * (1 - share)))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// --- checks -----------------------------------------------------------------------------------

function checkManifest(manifest) {
  const errors = []
  if (manifest.manifestVersion !== 2) {
    errors.push('manifestVersion must be 2')
  }
  if (manifest.execution !== 'data') {
    errors.push('execution must be "data"')
  }
  if (!manifest.publisher) {
    errors.push('publisher is required before Orca 1.4.246')
  }
  if (/^orca/i.test(manifest.publisher) || manifest.id.startsWith('orca-')) {
    errors.push('orca* publisher / orca- id are reserved for the official catalog')
  }
  for (const entries of Object.values(manifest.contributes)) {
    for (const { path } of entries) {
      const size = statSync(join(ROOT, path)).size
      if (size > MAX_FILE_BYTES) {
        errors.push(`${path}: ${size} bytes exceeds 16 KiB`)
      }
    }
  }
  return errors
}

function checkTokenSyntax(tokens) {
  const errors = []
  for (const [name, value] of Object.entries(tokens)) {
    if (!KNOWN_TOKENS.has(name)) {
      errors.push(`unknown token ${name}`)
    }
    if (!HEX.test(value)) {
      errors.push(`${name}: not a 6- or 8-digit hex color`)
    }
  }
  for (const name of ['--background', '--foreground']) {
    if (!tokens[name]) {
      errors.push(`${name} is required`)
    }
  }
  return errors
}

function checkTextPairs(tokens) {
  const errors = []
  for (const [surface, text] of TEXT_PAIRS) {
    if (!tokens[surface] || !tokens[text]) {
      continue
    }
    const ratio = contrast(tokens[surface], tokens[text])
    if (ratio < TEXT_CONTRAST) {
      errors.push(`${text} on ${surface}: ${ratio.toFixed(2)} < ${TEXT_CONTRAST}`)
    }
  }
  return errors
}

function checkAccentColors(tokens) {
  const errors = []
  for (const [surface, color] of ACCENT_PAIRS) {
    if (!tokens[color]) {
      continue
    }
    if (!OPAQUE_HEX.test(tokens[color])) {
      errors.push(`${color}: must be opaque`)
      continue
    }
    const ratio = contrast(tokens[surface], tokens[color])
    if (ratio < ACCENT_CONTRAST) {
      errors.push(`${color} on ${surface}: ${ratio.toFixed(2)} < ${ACCENT_CONTRAST}`)
    }
  }
  const indicator = contrast(tokens['--tab-active'], tokens['--tab-active-indicator'])
  if (indicator < INDICATOR_CONTRAST) {
    errors.push('--tab-active-indicator on --tab-active < 2')
  }
  return errors
}

// Orca derives chat colors from --background/--foreground/--muted-foreground but only checks the
// tokens, not the derived canvas, so text can end up unreadable while every token check passes.
function deriveChat(tokens) {
  const fg = tokens['--foreground']
  const canvas = mix(fg, CHAT.canvasFg, tokens['--background'])
  return {
    canvas,
    text: mix(fg, CHAT.text, canvas),
    strong: mix(fg, CHAT.strong, canvas),
    faint: mix(tokens['--muted-foreground'], CHAT.faint, canvas),
  }
}

function checkChat(tokens, chat) {
  const errors = []
  for (const name of ['text', 'strong', 'faint']) {
    const ratio = contrast(chat.canvas, chat[name])
    if (ratio < TEXT_CONTRAST) {
      errors.push(`chat ${name} ${chat[name]} on derived canvas ${chat.canvas}: ${ratio.toFixed(2)} < ${TEXT_CONTRAST}`)
    }
  }
  const bubble = tokens['--chat-user-message']
  if (bubble && contrast(bubble, chat.strong) < TEXT_CONTRAST) {
    errors.push('chat strong text on --chat-user-message < 4.5 (Orca drops the bubble color)')
  }
  return errors
}

// Code colors below ACCENT_CONTRAST against the editor background are dropped.
function checkCodeColors(theme) {
  const errors = []
  const editorBg = theme.tokens['--editor-surface'] ?? theme.tokens['--background']
  for (const { scope, settings } of theme.tokenColors) {
    if (!scope) {
      errors.push('tokenColors entry without scope')
    }
    if (!settings.foreground) {
      continue
    }
    const ratio = contrast(editorBg, settings.foreground)
    if (ratio < ACCENT_CONTRAST) {
      errors.push(`${JSON.stringify(scope)} ${settings.foreground}: ${ratio.toFixed(2)} < ${ACCENT_CONTRAST} (would be dropped)`)
    }
  }
  return errors
}

function checkTerminal(palette) {
  return Object.entries(palette)
    .filter(([, value]) => !HEX.test(value))
    .map(([name]) => `terminal.${name}: not hex`)
}

// --- run --------------------------------------------------------------------------------------

const theme = readJson('themes/palenight.json')
const manifestJson = readJson('orca-plugin.json')
const terminalJson = readJson('terminal/palenight.json')

const chat = deriveChat(theme.tokens)

const errors = [
  ...checkManifest(manifestJson),
  ...checkTokenSyntax(theme.tokens),
  ...checkTextPairs(theme.tokens),
  ...checkAccentColors(theme.tokens),
  ...checkChat(theme.tokens, chat),
  ...checkCodeColors(theme),
  ...checkTerminal(terminalJson.terminal),
]

console.log(`chat canvas ${chat.canvas}, text ${chat.text}, strong ${chat.strong}, faint ${chat.faint}`)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('ok')
