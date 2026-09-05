import { expect, test, type Page } from '@playwright/test'

// Same as the arcade specs: a software-rasterised 3D scene needs room to breathe.
test.describe.configure({ timeout: 120_000 })

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('the journey is reachable from the menu and opens on the first chapter', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')

  const journey = page.getByRole('button', { name: /The Journey/i })
  await expect(journey).toBeVisible()
  // The button names where you are, so a returning player knows what they're
  // resuming rather than just being told "play".
  await expect(journey).toContainText('Home Meadow')

  await journey.tap()
  await expect(page.getByText('HOME MEADOW')).toBeVisible({ timeout: 60_000 })
  expect(errors).toEqual([])
})

test('a chapter shows its objectives and no clock', async ({ page }) => {
  await page.goto('/?chapter=1')

  const checklist = page.getByRole('list', { name: /What to do here/i })
  await expect(checklist).toBeVisible({ timeout: 60_000 })

  // Chapter one teaches the loop one verb at a time.
  await expect(checklist).toContainText('Smash lemons')
  await expect(checklist).toContainText('Make lemonade')
  await expect(checklist).toContainText('Give out lemonade')
  await expect(checklist.getByRole('listitem')).toHaveCount(3)

  // The whole point of story mode: nothing is counting down. The arcade HUD
  // labels its timer "Sunset", so its absence is the thing worth asserting.
  await expect(page.getByText('Sunset', { exact: true })).toBeHidden()
})

test('each chapter is its own place', async ({ page }) => {
  await page.goto('/?chapter=4')
  await expect(page.getByText('THE GREY RIDGE')).toBeVisible({ timeout: 60_000 })

  const checklist = page.getByRole('list', { name: /What to do here/i })
  await expect(checklist).toContainText('Bring back the colour')

  // The ridge asks for five of its seven, not for everyone — chapters differ in
  // what they want, not just in how they look.
  await expect(checklist).toContainText('0/5')
})

test('a finished chapter says only what actually happened', async ({ page }) => {
  // Chapters 2-4 ask for some of their creatures, not all, so the ending card
  // must not claim everyone got a cup. `?over=woke` frees the lot, which is the
  // one case where it may.
  await page.goto('/?chapter=2&over=woke')
  await expect(page.getByText(/THE POND HOLLOW IS AWAKE/i)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/Everyone here has had a cup/i)).toBeVisible()
})

test('objectives tick over as the simulation runs', async ({ page }) => {
  await page.goto('/?chapter=1')
  const checklist = page.getByRole('list', { name: /What to do here/i })
  await expect(checklist).toBeVisible({ timeout: 60_000 })

  const smashLine = checklist.getByRole('listitem').first()
  await expect(smashLine).toContainText('0/8')

  // Follow the visible guide and hold Smash until a real hit registers. Fixed
  // 700ms keyboard taps barely move on Linux's software GPU; the test should
  // wait for gameplay, rather than assume a particular rendering speed.
  const arrow = page.locator('.guide-compass b')
  await expect(arrow).toBeVisible()
  const angle = await arrow.evaluate(element =>
    Number(element.style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1] ?? 0) * Math.PI / 180)
  const joystick = page.locator('.joystick')
  const box = (await joystick.boundingBox())!
  await joystick.dispatchEvent('pointerdown', {
    pointerId: 11, pointerType: 'touch',
    clientX: box.x + box.width / 2 + Math.sin(angle) * box.width * 0.32,
    clientY: box.y + box.height / 2 - Math.cos(angle) * box.width * 0.32,
  })
  await page.locator('.smash-control').dispatchEvent('pointerdown', {pointerId:12, pointerType:'touch'})
  await expect(smashLine).not.toContainText('0/8', {timeout:45000})
  await joystick.dispatchEvent('pointerup', {pointerId:11, pointerType:'touch'})
  await page.locator('.smash-control').dispatchEvent('pointerup', {pointerId:12, pointerType:'touch'})
})
