import { chromium } from '@playwright/test'
const out = process.argv[2]
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
// Force the clock forward by shrinking the round: `over` sets timeLeft to 0,
// but we want the *approach* to sunset, so drive dusk via a short round instead.
for (const [label, q] of [['dusk-early','?mode=arcade&go=1&heal=1'],['dusk-late','?mode=arcade&go=1&heal=1&dusk=0.85'],['dusk-end','?mode=arcade&go=1&heal=1&dusk=1']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto(`http://localhost:5173/${q}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(7000)
  await page.screenshot({ path: `${out}/${label}.png` })
  await page.close()
}
await browser.close(); console.log('ok')
