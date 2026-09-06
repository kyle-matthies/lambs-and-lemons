import { expect, test, type Page } from '@playwright/test'

// Build realistic checkpoint fixtures through the existing save format. Serving,
// conversations, finishing, and revisiting still use the player's actual controls.
async function meetNeighbour(page: Page, lastCup = false) {
  await page.goto('/?chapter=1')
  await expect(page.locator('.story-hud')).toBeVisible()
  await page.getByRole('button', { name: 'Pause game' }).click()
  await page.addInitScript(() => {
    const pending = sessionStorage.getItem('test-neighbour-checkpoint')
    if (pending) {
      localStorage.setItem('lammy-checkpoint-v1:home-meadow', pending)
      sessionStorage.removeItem('test-neighbour-checkpoint')
    }
  })
  await page.evaluate((last) => {
    const key = 'lammy-checkpoint-v1:home-meadow'
    const saved = JSON.parse(localStorage.getItem(key)!)
    const live = saved.live
    const friend = live.critters[last ? 2 : 0]
    live.player.x = friend.x
    live.player.z = friend.z + 0.8
    live.player.vx = live.player.vz = 0
    live.inventory.cups = 1
    if (last) {
      live.critters
        .slice(0, 2)
        .forEach((c: { state: string; followIndex: number }, i: number) => {
          c.state = 'follower'
          c.followIndex = i
        })
      live.stats.crittersFreed =
        live.stats.cupsSold =
        live.inventory.sold =
        live.flockSize =
          2
    }
    sessionStorage.setItem('test-neighbour-checkpoint', JSON.stringify(saved))
  }, lastCup)
  await page.reload()
  await expect(page.locator('.story-hud')).toBeVisible()
}

test('a conversation pauses play and remembers a named neighbour', async ({
  page,
}) => {
  await meetNeighbour(page)
  await page.getByRole('button', { name: 'Say hello to Clover' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Clover' })).toBeVisible()
  await expect(dialog).toContainText('wrong blanket')
  await expect(page.locator('.controls-layer')).toHaveAttribute('inert', '')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'See you around' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'See you around' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Pause game' }).click()
  await page.getByRole('button', { name: 'Journal & chapter map' }).click()
  const journal = page.getByRole('region', { name: 'Valley journal' })
  await expect(journal.getByRole('heading', { name: 'Clover' })).toBeVisible()
  await expect(journal).toContainText('A new acquaintance')
  await page.goto('/')
  await page.getByRole('button', { name: /Explore the chapter map/ }).click()
  await expect(journal.getByRole('heading', { name: 'Clover' })).toBeVisible()
})

test('sharing a real cup changes the resident relationship and journal', async ({
  page,
}) => {
  await meetNeighbour(page)
  const give = page.getByRole('button', { name: 'Give a cup' })
  await expect(give).toBeVisible()
  await give.click()
  // Pointer down is the touch action; click alone also dispatches that sequence.
  await expect(page.locator('.shared-moment')).toContainText(
    'Clover · a cup shared',
  )
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('lammy-neighbours-v1')!).shared,
      ),
    )
    .toContain('home-meadow:1')
  await page.getByRole('button', { name: 'Say hello to Clover' }).click()
  await expect(page.getByRole('dialog')).toContainText('The blanket can stay')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('a real final cup unlocks a keepsake and a lasting place to revisit', async ({
  page,
}) => {
  await meetNeighbour(page, true)
  await page.getByRole('button', { name: 'Give a cup' }).click()
  await expect(
    page.getByRole('heading', { name: 'Home Meadow is awake' }),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Clover’s picnic flower')
  await page.getByRole('button', { name: 'Stay a little longer' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.at-home-note')).toBeVisible()
  await page.getByRole('button', { name: 'Pause game' }).click()
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!).live,
  )
  await page.reload()
  await expect(page.locator('.at-home-note')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Pause game' }).click()
  const after = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!).live,
  )
  expect(after.outcome).toBe('valleyWoke')
  expect(after.stats.crittersFreed).toBe(3)
  expect(after.inventory.score).toBe(before.inventory.score)
  await page.getByRole('button', { name: 'Journal & chapter map' }).click()
  await expect(page.getByRole('list', { name: 'Keepsakes' })).toContainText(
    'Clover’s picnic flower',
  )
  await page
    .getByRole('button', { name: /Home Meadow, complete, visit again/ })
    .click()
  await expect(page.locator('.at-home-note')).toBeVisible()
})
