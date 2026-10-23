// Generates app/althea-theme.generated.css: maps every hard-coded color utility used by the dashboard
// (app/dashboard + components) to the semantic tokens in app/althea-theme.css.
// Run after adding new color classes: `npm run theme:generate`.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app/dashboard', 'components']
const OUT = 'app/althea-theme.generated.css'
const SCOPE = ':where(.althea-ds, .althea-ds *)'

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
  })
}

// ---- color helpers -------------------------------------------------------
const TW = { // tailwind gray families: shade -> role
  50: 'text', 100: 'text', 200: 'text', 300: 'muted', 400: 'muted', 500: 'subtle', 600: 'subtle', 700: 'subtle', 800: 'dark', 900: 'dark', 950: 'dark',
}
function parseColor(raw) {
  let m = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  m = raw.match(/^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)$/)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1 }
  return null
}
function hsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return { h, s, l }
}
// Accent hues keep their meaning but get a readable shade on white.
function accent(c) {
  const { h, s, l } = hsl(c)
  if (s < 0.3 || l < 0.2) return null
  if (h >= 80 && h <= 175) return 'var(--ds-brand-text)'
  if (h >= 35 && h < 80) return 'var(--ds-gold-text)'
  if (h < 20 || h >= 330) return 'var(--ds-danger-text)'
  return null
}
// Named Tailwind accents: light shades (made for dark backgrounds) get a readable token on white.
const ACCENT_FAMILY = {
  emerald: 'brand', green: 'brand', lime: 'brand', teal: 'brand',
  amber: 'gold', yellow: 'gold', orange: 'gold',
  red: 'danger', rose: 'danger', pink: 'danger',
  blue: 'info', sky: 'info', cyan: 'info', indigo: 'info', violet: 'info', purple: 'info', fuchsia: 'info',
}
const ACCENT_TOKEN = { brand: 'var(--ds-brand-text)', gold: 'var(--ds-gold-text)', danger: 'var(--ds-danger-text)', info: 'var(--ds-info-text)' }
const named = (color) => {
  const m = color.match(/^([a-z]+)-(\d+)$/)
  return m && ACCENT_FAMILY[m[1]] ? { token: ACCENT_TOKEN[ACCENT_FAMILY[m[1]]], shade: +m[2] } : null
}
const alphaOf = (mod) => {
  if (!mod) return 1
  const n = mod.replace(/^\[|\]$/g, '')
  return n.includes('.') || n.startsWith('0') ? parseFloat(n) : parseInt(n, 10) / 100
}
const mix = (token, a) => (a >= 0.999 ? token : `color-mix(in srgb, ${token} ${Math.round(a * 1000) / 10}%, transparent)`)

// ---- classification ------------------------------------------------------
// Returns a CSS declaration value for `prop` or null to leave the class alone.
function background(color, mod) {
  const a = alphaOf(mod)
  if (color === 'white') return a >= 0.6 ? mix('var(--ds-inverse)', a) : `rgb(var(--ds-tint-rgb) / ${a})`
  if (color === 'black') return a >= 0.5 ? 'var(--ds-scrim)' : `rgb(var(--ds-shade-rgb) / calc(${a} * var(--ds-shade-k)))`
  const acc = named(color)
  if (acc) return acc.shade >= 800 ? mix(acc.token, 0.08 * a) : null // dark-tinted fills become soft tints
  const fam = color.match(/^(slate|zinc|neutral|gray|stone)-(\d+)$/)
  if (fam) return +fam[2] >= 800 ? mix(+fam[2] >= 900 ? 'var(--ds-surface)' : 'var(--ds-surface-2)', a) : +fam[2] >= 500 ? mix('var(--ds-border-strong)', a) : null
  const c = parseColor(color.replace(/^\[|\]$/g, '').replace(/_/g, ' '))
  if (!c) return null
  const { s, l } = hsl(c)
  if (l > 0.2) return null // brand/gold/red fills keep their color
  const alpha = Math.min(c.a, 1) * a
  const greenish = c.g - Math.max(c.r, c.b) > 14 && s > 0.3
  const token = greenish ? 'var(--ds-surface-brand)' : Math.max(c.r, c.g, c.b) <= 0x0b ? 'var(--ds-bg)' : Math.max(c.r, c.g, c.b) <= 0x11 ? 'var(--ds-surface)' : 'var(--ds-surface-2)'
  return mix(token, alpha)
}
function text(color, mod) {
  const a = alphaOf(mod)
  if (color === 'black') return null
  const roleToken = { text: 'var(--ds-text)', muted: 'var(--ds-text-muted)', subtle: 'var(--ds-text-subtle)' }
  if (color === 'white') {
    const role = a >= 0.8 ? 'text' : a >= 0.5 ? 'muted' : 'subtle'
    return roleToken[role]
  }
  const namedAccent = named(color)
  if (namedAccent) return namedAccent.shade <= 500 ? mix(namedAccent.token, a) : null
  const fam = color.match(/^(slate|zinc|neutral|gray|stone)-(\d+)$/)
  if (fam) return roleToken[TW[fam[2]]] ?? null
  const c = parseColor(color.replace(/^\[|\]$/g, ''))
  if (!c) return null
  const acc = accent(c)
  if (acc) return mix(acc, a)
  const { l } = hsl(c)
  if (l < 0.12) return null // already dark text (e.g. on brand buttons)
  return l > 0.75 ? 'var(--ds-text)' : l > 0.5 ? 'var(--ds-text-muted)' : 'var(--ds-text-subtle)'
}
function border(color, mod) {
  const a = alphaOf(mod)
  if (color === 'white') return a >= 0.12 ? 'var(--ds-border-strong)' : 'var(--ds-border)'
  if (color === 'black') return 'var(--ds-border)'
  const acc = named(color)
  if (acc) return acc.shade >= 700 ? mix(acc.token, 0.25) : null
  const fam = color.match(/^(slate|zinc|neutral|gray|stone)-(\d+)$/)
  if (fam) return +fam[2] >= 600 ? 'var(--ds-border)' : null
  const c = parseColor(color.replace(/^\[|\]$/g, ''))
  if (!c) return null
  const { s, l } = hsl(c)
  if (l > 0.2) return null // accent borders keep their color
  return c.g - Math.max(c.r, c.b) > 14 && s > 0.3 ? 'var(--ds-border-brand)' : 'var(--ds-border)'
}
function shadow(arbitrary) {
  return /rgba\(0,0,0/.test(arbitrary.replace(/\s/g, '')) ? 'var(--ds-shadow)' : null
}

// ---- selectors -----------------------------------------------------------
const PSEUDO = { hover: ':hover', focus: ':focus', 'focus-visible': ':focus-visible', active: ':active', disabled: ':disabled', 'focus-within': ':focus-within' }
const RESPONSIVE = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'max-sm', 'max-md', 'max-lg'])
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

function rule(token) {
  const parts = token.split(':')
  const utility = parts.pop()
  let pseudo = ''
  let group = ''
  let placeholder = false
  for (const variant of parts) {
    if (RESPONSIVE.has(variant)) continue
    if (PSEUDO[variant]) pseudo += PSEUDO[variant]
    else if (variant === 'group-hover') group = '.group:hover '
    else if (variant === 'placeholder') placeholder = true
    else return null
  }
  const m = utility.match(/^(bg|text|border(?:-[trblxy])?|divide|from|via|to|shadow|ring)-(\[[^\]]+\]|white|black|[a-z]+-\d+)(?:\/(\[[.0-9]+\]|\d+))?$/)
  if (!m) return null
  const [, kind, color, mod] = m
  if (kind === 'text' && /^\[\d/.test(color)) return null // text-[10px] is a size
  let decl = null
  let suffix = ''
  if (kind === 'bg') { const v = background(color, mod); decl = v && `background-color: ${v} !important` }
  else if (kind === 'text') { const v = text(color, mod); decl = v && `color: ${v} !important` }
  else if (kind.startsWith('border')) { const v = border(color, mod); decl = v && `border-color: ${v} !important` }
  else if (kind === 'divide') { const v = border(color, mod); decl = v && `border-color: ${v} !important`; suffix = ' > :not(:last-child)' }
  else if (kind === 'ring') { const v = border(color, mod); decl = v && `--tw-ring-color: ${v} !important` }
  else if (kind === 'shadow') { const v = color.startsWith('[') ? shadow(color) : color === 'black' ? 'var(--ds-shadow)' : null; decl = v && `box-shadow: ${v} !important` }
  else { const v = background(color, mod); decl = v && `--tw-gradient-${kind}: ${v} !important` }
  if (!decl) return null
  const selector = `${group}${SCOPE}[class~="${esc(token)}"]${pseudo}${suffix}${placeholder ? '::placeholder' : ''}`
  return { selector, decl }
}

const tokens = new Set()
for (const root of ROOTS) {
  for (const file of files(root)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/[\w:.[\]#/(),%-]*(?:bg|text|border|divide|from|via|to|shadow|ring)-(?:\[[^\]\s]+\]|white|black|[a-z]+-\d{2,3})(?:\/(?:\[[.0-9]+\]|\d+))?/g)) {
      tokens.add(m[0].replace(/^[^a-z[]+/i, ''))
    }
  }
}

const byDecl = new Map()
for (const token of [...tokens].sort()) {
  const r = rule(token)
  if (!r) continue
  byDecl.set(r.decl, [...(byDecl.get(r.decl) ?? []), r.selector])
}
const css = [...byDecl].map(([decl, selectors]) => `${selectors.join(',\n')} { ${decl}; }`).join('\n')
writeFileSync(OUT, `/* GENERATED by scripts/generate-theme.mjs — do not edit. Maps legacy color utilities to app/althea-theme.css tokens. */\n${css}\n`)
console.log(`${OUT}: ${[...byDecl.values()].flat().length} selectors from ${tokens.size} color utilities`)
