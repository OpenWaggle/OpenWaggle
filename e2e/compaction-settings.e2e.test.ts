import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'

async function openGeneralSettings(app: OpenWaggleApp) {
  const page = app.mainWindow().page
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'General' }).click()
  await expect(page.getByRole('heading', { name: 'Context compaction' })).toBeVisible()
  return page
}

test('global automatic compaction threshold defaults to 80 percent and persists', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-compaction-settings-e2e-')

  try {
    let page = await openGeneralSettings(app)
    let threshold = page.getByRole('spinbutton', { name: 'Automatic compaction threshold' })
    await expect(threshold).toHaveValue('80')
    await expect(page.getByText('%', { exact: true })).toBeVisible()

    await threshold.fill('73')
    await threshold.press('Enter')
    await expect(threshold).toHaveValue('73')
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.api.getSettings()).compactionThresholdPercent),
      )
      .toBe(73)

    await app.restart()
    page = await openGeneralSettings(app)
    threshold = page.getByRole('spinbutton', { name: 'Automatic compaction threshold' })
    await expect(threshold).toHaveValue('73')
  } finally {
    await app.cleanup()
  }
})
