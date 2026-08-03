import { expect, test, type Page } from '@playwright/test'

// The arcade is a 3D scene; headless Chromium software-rasterises it, so both
// world generation and the simulation run well below real time.
test.describe.configure({ timeout: 120_000 })

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('menu renders both modes without errors', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Lammy's Lemonade Smash/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Smash!/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /My Stand/i })).toBeVisible()
  expect(errors).toEqual([])
})

test('how-to-play opens and closes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'How to play' }).tap()
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible()
  await page.getByRole('button', { name: 'OK!' }).tap()
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeHidden()
})

test('arcade round: move with joystick while smashing, score increases', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Smash!/i }).tap()
  await page.getByRole('button', { name: 'Go!' }).tap()

  const joystick = page.locator('.joystick')
  await expect(joystick).toBeVisible()
  const box = await joystick.boundingBox()
  if (!box) throw new Error('joystick not laid out')
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2

  // Hold the joystick up-left with one pointer while tapping smash with another
  // — this is the two-thumb phone grip.
  await joystick.dispatchEvent('pointerdown', {
    pointerId: 11,
    clientX: centerX,
    clientY: centerY,
    isPrimary: true,
    pointerType: 'touch',
  })
  await joystick.dispatchEvent('pointermove', {
    pointerId: 11,
    clientX: centerX - 30,
    clientY: centerY - 30,
    pointerType: 'touch',
  })

  const smash = page.locator('.smash-control')
  for (let index = 0; index < 6; index += 1) {
    await smash.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch' })
    await page.waitForTimeout(320)
  }
  await joystick.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch' })

  const points = await page
    .locator('.hud-card', { hasText: 'Points' })
    .locator('strong')
    .innerText()
  expect(Number(points)).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('keyboard controls move the lamb and smash', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Smash!/i }).tap()
  await page.getByRole('button', { name: 'Go!' }).tap()

  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(900)
  await page.keyboard.up('ArrowUp')
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
  }

  const points = await page
    .locator('.hud-card', { hasText: 'Points' })
    .locator('strong')
    .innerText()
  expect(Number(points)).toBeGreaterThan(0)
})

test('landscape layout keeps controls on screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')
  await page.getByRole('button', { name: /Smash!/i }).tap()
  await page.getByRole('button', { name: 'Go!' }).tap()

  const joystick = await page.locator('.joystick').boundingBox()
  const smash = await page.locator('.smash-control').boundingBox()
  expect(joystick).not.toBeNull()
  expect(smash).not.toBeNull()
  if (joystick && smash) {
    expect(joystick.y + joystick.height).toBeLessThanOrEqual(390)
    expect(smash.y + smash.height).toBeLessThanOrEqual(390)
    expect(smash.x + smash.width).toBeLessThanOrEqual(844)
  }
})

test('the bloom meter is wired to the simulation', async ({ page }) => {
  const errors = watchErrors(page)
  // Straight into a running round so the whole budget goes on play, not menus.
  await page.goto('/?mode=arcade&go=1')

  const meter = page.locator('.bloom-meter')
  await expect(meter).toBeVisible({ timeout: 30_000 })

  // The valley opens with a scrap of colour around Lammy and the stand, so a
  // meter reading zero would mean the HUD isn't reading the simulation at all.
  const label = await meter.getAttribute('aria-label')
  const announced = Number((label ?? '').replace(/\D/g, ''))
  expect(announced).toBeGreaterThan(0)

  // ...and the bar the player actually sees agrees with what's announced.
  const width = await page.locator('.bloom-fill').evaluate((element) => element.style.width)
  expect(Number(width.replace('%', ''))).toBe(announced)

  // That the number *grows* as you smash is asserted in `npm run test:sim`,
  // which plays whole rounds in about a second. Here the software rasteriser
  // runs the simulation at roughly a twentieth of real time, so a browser test
  // of the same thing would be measuring the renderer, not the mechanic.
  await page.keyboard.press('Space')
  expect(errors).toEqual([])
})

test('the HUD tracks the creatures still waiting', async ({ page }) => {
  await page.goto('/?mode=arcade&go=1')

  const friends = page.locator('.hud-card', { hasText: 'Friends' }).locator('strong')
  await expect(friends).toBeVisible({ timeout: 30_000 })
  // Nobody has been helped yet, and there is a whole valley of them to find.
  await expect(friends).toHaveText(/^0\/\d+$/)

  const cups = page.locator('.hud-card', { hasText: 'Cups' }).locator('strong')
  await expect(cups).toHaveText('0')
})
