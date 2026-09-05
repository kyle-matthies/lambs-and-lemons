import { test, expect } from '@playwright/test'

test('pause freezes the round and resumes without a time jump', async ({
  page,
}) => {
  await page.goto('/?mode=arcade&go=1')
  await expect(page.locator('.hud')).toBeVisible()
  await page.getByRole('button', { name: 'Pause game' }).click()
  const timer = page
    .locator('.hud-card', { hasText: 'Sunset' })
    .locator('strong')
  const before = await timer.textContent()
  await page.waitForTimeout(1200)
  await page.keyboard.press('Space')
  // The focused resume button may be activated by Space. Pause again explicitly.
  if (!(await page.getByRole('dialog').isVisible()))
    await page.getByRole('button', { name: 'Pause game' }).click()
  expect(await timer.textContent()).toBe(before)
  await page.getByRole('button', { name: 'Keep playing' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(timer).not.toHaveText(before!, { timeout: 20000 })
})

test('chapter completion persists before leaving the ending and unlocks the next place', async ({
  page,
}) => {
  await page.goto('/?chapter=1&over=woke')
  await expect(
    page.getByRole('heading', { name: /HOME MEADOW IS AWAKE/ }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('lammy-journey-v1') ?? '{}')
            .completed,
      ),
    )
    .toContain('home-meadow')
  await page.goto('/')
  await page.getByRole('button', { name: /Explore the chapter map/ }).click()
  await expect(
    page.getByRole('button', { name: /Home Meadow, complete/ }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: /The Pond Hollow, ready/ }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: /The Old Orchard, locked/ }),
  ).toBeDisabled()
  await page.getByRole('button', { name: /The Pond Hollow, ready/ }).click()
  await expect(page.locator('.chapter-name')).toHaveText('The Pond Hollow')
})

test('damaged saved data does not strand the menu', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('lammy-journey-v1', '{"current":null,"completed":{}}'),
  )
  await page.goto('/')
  await page.getByRole('button', { name: /The Journey/ }).click()
  await expect(page.locator('.chapter-name')).toHaveText('Home Meadow')
})

test('short portrait and landscape menus keep every action reachable', async ({
  page,
}) => {
  for (const size of [
    { width: 375, height: 667 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    await page.goto('/')
    for (const name of [
      /The Journey/,
      /Smash!/,
      /My Stand/,
      /Explore the chapter map/,
      /How to play/,
    ]) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeInViewport({ ratio: 1 })
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})

test('a browser interruption pauses and clears touch input', async ({
  page,
}) => {
  await page.goto('/?chapter=1')
  const joystick = page.locator('.joystick')
  await expect(joystick).toBeVisible()
  const box = (await joystick.boundingBox())!
  await joystick.dispatchEvent('pointerdown', {
    pointerId: 11,
    pointerType: 'touch',
    clientX: box.x + box.width,
    clientY: box.y,
  })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.joystick-knob')).toHaveAttribute(
    'style',
    /translate\(0px, 0px\)/,
  )
  await page.getByRole('button', { name: 'Keep playing' }).click()
  await expect(page.locator('.joystick-knob')).toHaveAttribute(
    'style',
    /translate\(0px, 0px\)/,
  )
})

test('a second finger cannot steal or release the movement joystick', async ({
  page,
}) => {
  await page.goto('/?chapter=1')
  const joystick = page.locator('.joystick')
  await expect(joystick).toBeVisible()
  const box = (await joystick.boundingBox())!
  const pointer = {
    pointerType: 'touch',
    clientX: box.x + box.width,
    clientY: box.y + box.height / 2,
  }
  await joystick.dispatchEvent('pointerdown', { ...pointer, pointerId: 11 })
  const held = await page.locator('.joystick-knob').getAttribute('style')
  await joystick.dispatchEvent('pointerdown', {
    ...pointer,
    pointerId: 12,
    clientX: box.x,
  })
  await joystick.dispatchEvent('pointerup', {
    pointerId: 12,
    pointerType: 'touch',
  })
  await expect(page.locator('.joystick-knob')).toHaveAttribute('style', held!)
  await joystick.dispatchEvent('pointercancel', {
    pointerId: 11,
    pointerType: 'touch',
  })
  await expect(page.locator('.joystick-knob')).toHaveAttribute(
    'style',
    /translate\(0px, 0px\)/,
  )
})

test('3D startup failure offers recovery instead of loading forever', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    // @ts-expect-error intentionally simulate unsupported WebGL while keeping 2D assets
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2') return null
      return original.call(this, type, ...args)
    }
  })
  await page.goto('/?chapter=1')
  await expect(page.getByRole('alert')).toContainText(
    'The valley couldn’t open',
  )
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await page.getByRole('button', { name: 'Back home' }).click()
  await expect(
    page.getByRole('heading', { name: /A little kindness/ }),
  ).toBeVisible()
})

test('unfinished chapters restore position, inventory, friends, and colour after reload', async ({
  page,
}) => {
  await page.goto('/?chapter=1')
  await expect(page.locator('.story-hud')).toBeVisible()
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(900)
  await page.keyboard.up('ArrowUp')
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Space')
    await page.waitForTimeout(260)
  }
  await page.getByRole('button', { name: 'Pause game' }).click()
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!),
  )
  expect(saved.live.elapsed).toBeGreaterThan(0)
  await page.reload()
  await expect(page.locator('.story-hud')).toBeVisible()
  await page.getByRole('button', { name: 'Pause game' }).click()
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!),
  )
  expect(restored.live.player.x).toBeCloseTo(saved.live.player.x, 1)
  expect(restored.live.player.z).toBeCloseTo(saved.live.player.z, 1)
  expect(restored.live.inventory).toEqual(saved.live.inventory)
  expect(restored.live.stats).toEqual(saved.live.stats)
  expect(restored.cells).toEqual(saved.cells)
})

test('losing the graphics context preserves a checkpoint and offers recovery', async ({
  page,
}) => {
  await page.goto('/?chapter=1')
  await expect(page.locator('.story-hud')).toBeVisible()
  await page
    .locator('.game-canvas')
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    )
  await expect(page.getByRole('alert')).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lammy-checkpoint-v1:home-meadow'),
    ),
  ).toBeTruthy()
})

test('keyboard movement still works with the sound button focused', async ({page}) => {
  await page.goto('/?chapter=1')
  await expect(page.locator('.story-hud')).toBeVisible()
  await page.getByRole('button', {name:'Pause game'}).click()
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!).live.player.z)
  await page.getByRole('button', {name:'Keep playing'}).click()
  await page.getByRole('button', {name:'Mute sounds'}).focus()
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(700)
  await page.keyboard.up('ArrowUp')
  await page.getByRole('button', {name:'Pause game'}).click()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('lammy-checkpoint-v1:home-meadow')!).live.player.z)
  expect(after).toBeLessThan(before)
})
