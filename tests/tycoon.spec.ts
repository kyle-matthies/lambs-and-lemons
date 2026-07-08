import { expect, test } from '@playwright/test'

test('tycoon: serve a full day-1 customer and earn coins', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.getByRole('button', { name: /My Stand/i }).tap()

  // Wait for the customer to arrive and order.
  const serve = page.getByRole('button', { name: /Serve!/i })
  await expect(serve).toBeVisible({ timeout: 10_000 })

  // Serve every cup the customer asked for (day 1 can be 1 cup).
  while (await serve.isVisible()) {
    await serve.tap()
    await page.waitForTimeout(250)
  }

  // Day 1 pays with exact 1-coins: tap each one to collect.
  const coins = page.locator('.pay-coins .coin:not(.collected)')
  await expect(coins.first()).toBeVisible()
  while ((await coins.count()) > 0) {
    await coins.first().tap()
    await page.waitForTimeout(200)
  }

  // Exact payment goes straight to the happy phase and pays price + tip.
  await expect(page.locator('.tycoon-caption.big')).toBeVisible({ timeout: 5_000 })
  const purseText = await page.locator('.tycoon-purse').innerText()
  const purse = Number(purseText.replace(/\D/g, ''))
  expect(purse).toBeGreaterThanOrEqual(4) // 1 cup: price 3 + tip 1
  expect(errors).toEqual([])
})

test('tycoon: purse persists back to the menu', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /My Stand/i }).tap()

  const serve = page.getByRole('button', { name: /Serve!/i })
  await expect(serve).toBeVisible({ timeout: 10_000 })
  while (await serve.isVisible()) {
    await serve.tap()
    await page.waitForTimeout(250)
  }
  const coins = page.locator('.pay-coins .coin:not(.collected)')
  while ((await coins.count()) > 0) {
    await coins.first().tap()
    await page.waitForTimeout(200)
  }
  await expect(page.locator('.tycoon-caption.big')).toBeVisible({ timeout: 5_000 })

  await page.getByRole('button', { name: 'Home' }).tap()
  const strip = await page.locator('.menu-strip').innerText()
  expect(strip).toMatch(/Coins: [1-9]/)
})
