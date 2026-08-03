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

test('objectives tick over as the simulation runs', async ({ page }) => {
  await page.goto('/?chapter=1')
  const checklist = page.getByRole('list', { name: /What to do here/i })
  await expect(checklist).toBeVisible({ timeout: 60_000 })

  const smashLine = checklist.getByRole('listitem').first()
  await expect(smashLine).toContainText('0/8')

  // Walk into the ring of fruit the chapter opens with, then swing — the mallet
  // only reaches a few metres, so standing still and swinging hits nothing. The
  // bot in `scripts/simulate.mjs` covers the whole loop; this only proves the
  // HUD is wired to the same state the simulation is changing.
  for (let sweep = 0; sweep < 4; sweep += 1) {
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(700)
    await page.keyboard.up('ArrowUp')
    for (let swing = 0; swing < 4; swing += 1) {
      await page.keyboard.press('Space')
      await page.waitForTimeout(260)
    }
  }

  await expect(smashLine).not.toContainText('0/8')
})
