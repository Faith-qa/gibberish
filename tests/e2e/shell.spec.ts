import { expect, test } from '@playwright/test'

test('shell loads without errors and fits the viewport', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const externalRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page).toHaveTitle('Gibberish')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('In development · M0')).toBeVisible()
  await expect(page.getByText(/You cannot enter or save journal content/)).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
  expect(externalRequests).toEqual([])
})

test('keyboard users can skip to the main content', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
})
