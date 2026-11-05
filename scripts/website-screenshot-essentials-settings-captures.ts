import type { Page } from '@playwright/test'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  spanRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import { prepareEssentials, TIGHT_PAD_PX } from './website-screenshot-essentials-setup'
import {
  type CaptureContext,
  GIT_READY_TIMEOUT_MS,
  leaveSettings,
  openSettingsSection,
  UI_TIMEOUT_MS,
  waitForUi,
} from './website-screenshot-ui'

/** Amazon Bedrock, Ant Ling, Anthropic (configured) and the provider after it. */
const API_KEY_ROWS_SHOWN = 4

/** One of the Connections provider groups, opened or closed. */
async function setProviderGroup(page: Page, title: string, open: boolean) {
  const toggle = page.getByRole('button', { name: new RegExp(`^${title}`) })
  if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await toggle.click()
  await waitForUi(page)
  return toggle
}

/**
 * Settings > Connections with both provider groups closed, so the page shows its whole shape:
 * API Key Providers, OAuth Providers, Source control and Available Models with three models on.
 */
export async function captureSettingsConnections(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSettingsSection(page, 'Connections', 'Connections')
  await setProviderGroup(page, 'API Key Providers', false)
  await setProviderGroup(page, 'OAuth Providers', false)
  const selected = page.getByText(/models selected$/).first()
  await selected.waitFor({ timeout: UI_TIMEOUT_MS })
  await page
    .getByText('Loading hosts…')
    .waitFor({ state: 'detached', timeout: GIT_READY_TIMEOUT_MS })
  const heading = page.getByRole('heading', { name: 'Connections', exact: true })
  const search = page.getByPlaceholder(/^Search by name, model ID or provider/)
  // From the page heading down to the model search, at the content column's width.
  await shootRegion(context, 'settings-connections.png', async () => {
    const bottom = await regionOf(search)
    return spanRegion({
      top: await regionOf(heading),
      bottom,
      across: bottom,
      pad: CROP_MARGIN_PX,
      bottomPad: TIGHT_PAD_PX,
    })
  })
  await leaveSettings(page)
}

/** The first rows of API Key Providers, where the fixture's Anthropic key shows as configured. */
export async function captureSettingsApiKeyProviders(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSettingsSection(page, 'Connections', 'Connections')
  await setProviderGroup(page, 'OAuth Providers', false)
  const toggle = await setProviderGroup(page, 'API Key Providers', true)
  const anthropic = page.getByRole('button', { name: 'Edit Anthropic API key' })
  await anthropic.waitFor({ timeout: UI_TIMEOUT_MS })
  await toggle.scrollIntoViewIfNeeded()
  const header = await regionOf(toggle)
  // Down to the row after Anthropic's, so a configured and an unconfigured key show together.
  const rows = page.getByRole('button', { name: /^Edit .* API key$/ })
  const lastRow = await regionOf(rows.nth(API_KEY_ROWS_SHOWN - 1))
  await shootRegion(
    context,
    'settings-api-key-providers.png',
    spanRegion({ top: header, bottom: lastRow, across: header, pad: CROP_MARGIN_PX }),
  )
  await setProviderGroup(page, 'API Key Providers', false)
  await leaveSettings(page)
}

/** OAuth Providers opened: every sign-in provider with its connection switch. */
export async function captureSettingsOAuthProviders(context: CaptureContext) {
  const { page } = context
  await prepareEssentials(context)
  await openSettingsSection(page, 'Connections', 'Connections')
  await setProviderGroup(page, 'API Key Providers', false)
  const toggle = await setProviderGroup(page, 'OAuth Providers', true)
  const list = toggle.locator('xpath=following-sibling::*[1]')
  await list.waitFor({ timeout: UI_TIMEOUT_MS })
  await toggle.scrollIntoViewIfNeeded()
  await shootRegion(
    context,
    'settings-oauth-providers.png',
    unionRegion([await regionOf(toggle), await regionOf(list)], CROP_MARGIN_PX),
  )
  await setProviderGroup(page, 'OAuth Providers', false)
  await leaveSettings(page)
}
