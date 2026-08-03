/**
 * Visual verification harness.
 *
 * Drives the real game in headless Chromium (SwiftShader) and writes screenshots,
 * because "it compiles" says nothing about whether the valley is beautiful.
 * SwiftShader runs at a few frames a second, so this is for *looking*, not for
 * judging feel or performance — use a real browser for those.
 *
 *   npm run dev                       # in another terminal
 *   npm run shots                     # default sweep into .shots/
 *   node scripts/shoot.mjs .shots '?mode=arcade&go=1&heal=1' 1280 800 healed
 *
 * Handy query params (see src/App.tsx and src/game/GameCanvas.tsx):
 *   mode=arcade|stand   open a mode directly
 *   go=1                skip the round-setup card
 *   heal=0..1           pin how far the valley has recovered
 */
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const outDir = process.argv[2] ?? '.shots'
const query = process.argv[3] ?? '?mode=arcade&go=1'
const width = Number(process.argv[4] ?? 1280)
const height = Number(process.argv[5] ?? 800)
const label = process.argv[6] ?? 'shot'
const base = process.env.BASE_URL ?? 'http://localhost:5173'

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('CONSOLE ERROR:', message.text())
})

await page.goto(`${base}/${query}`, { waitUntil: 'networkidle' })
// Software rasterising the first frames is slow; give the world time to settle.
await page.waitForTimeout(6000)
await page.screenshot({ path: `${outDir}/${label}.png` })

await browser.close()
console.log('→', `${outDir}/${label}.png`)
