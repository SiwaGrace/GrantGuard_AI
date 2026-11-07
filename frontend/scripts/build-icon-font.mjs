// Regenerates the self-hosted Material Symbols subset in src/assets/fonts/.
//
// The app only ships the icons it uses, so after adding a new icon name in
// the code, run:   node scripts/build-icon-font.mjs   (from frontend/)
// and commit the updated .woff2. Icons missing from the subset render as
// their name in plain text.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const outFile = join(srcDir, 'assets', 'fonts', 'material-symbols-outlined-subset.woff2')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(jsx?|tsx?)$/.test(name) ? [path] : []
  })
}

const ICON_NAME = /^[a-z][a-z0-9_]*$/
const names = new Set()
const add = (value) => ICON_NAME.test(value) && names.add(value)

for (const file of sourceFiles(srcDir)) {
  const code = readFileSync(file, 'utf8')

  // Contents of every icon span: a bare name, or string literals in {...}
  for (const [, inner] of code.matchAll(/material-symbols-outlined[^>]*>([\s\S]*?)<\/span>/g)) {
    const text = inner.trim()
    if (!text.startsWith('{')) add(text)
    for (const [, literal] of text.matchAll(/'([a-z0-9_]+)'/g)) add(literal)
  }
  // Names chosen at runtime: icon: 'x' map entries, icon="x" props,
  // and ['value', 'icon_name', 'Label'] tuples
  for (const [, n] of code.matchAll(/\bicon:\s*'([a-z0-9_]+)'/g)) add(n)
  for (const [, n] of code.matchAll(/\bicon="([a-z0-9_]+)"/g)) add(n)
  for (const [, n] of code.matchAll(/\[\s*'[a-z]+',\s*'([a-z0-9_]+)',\s*'[^']+'\s*\]/g)) add(n)
}

const sorted = [...names].sort()
// Fixed opsz/wght/GRAD (as set in index.css); FILL 0..1 for .filled-icon
const cssUrl =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0' +
  `&icon_names=${sorted.join(',')}&display=block`

// A modern browser user agent makes Google serve woff2
const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
}
const css = await (await fetch(cssUrl, { headers })).text()
const fontUrl = css.match(/url\((https:[^)]+)\)/)?.[1]
if (!fontUrl) {
  console.error('Could not find a font URL in the Google Fonts response:\n' + css.slice(0, 500))
  process.exit(1)
}

const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer())
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, font)
console.log(`${sorted.length} icons -> ${outFile} (${(font.length / 1024).toFixed(1)} KB)`)
console.log(sorted.join(' '))
