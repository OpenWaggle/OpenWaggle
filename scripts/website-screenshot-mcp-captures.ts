import type { Page } from '@playwright/test'
import {
  CROP_MARGIN_PX,
  regionOf,
  shootRegion,
  unionRegion,
} from './website-screenshot-capture-kit'
import {
  MCP_CONNECTED_SERVER,
  MCP_FAILING_SERVER,
  MCP_SECRET_SERVER,
  writeMcpFixture,
} from './website-screenshot-mcp-fixture'
import { type CaptureContext, leaveSettings, UI_TIMEOUT_MS } from './website-screenshot-ui'

const CHECK_TIMEOUT_MS = 60_000

function serverList(page: Page) {
  return page.getByRole('list', { name: 'MCP servers' })
}

function serverRow(page: Page, name: string) {
  return serverList(page).getByRole('button', { name: new RegExp(`^Open ${name}\\b`) })
}

/** Settings > MCP with the fixture servers listed; Refresh rereads the files written meanwhile. */
async function openMcpSettings(context: CaptureContext) {
  const { page } = context
  await writeMcpFixture(context.homeDir)
  const back = page.getByRole('button', { name: 'Back to app' })
  if ((await back.count()) === 0) {
    await page.getByRole('button', { name: 'Settings' }).first().click()
  }
  await page.getByRole('button', { name: 'MCP', exact: true }).first().click()
  const allServers = page.getByRole('button', { name: 'All servers' })
  if ((await allServers.count()) > 0) await allServers.click()
  await page.getByRole('button', { name: 'Refresh' }).click()
  for (const name of [MCP_CONNECTED_SERVER, MCP_FAILING_SERVER, MCP_SECRET_SERVER]) {
    await serverRow(page, name).waitFor({ timeout: UI_TIMEOUT_MS })
  }
}

async function openServer(page: Page, name: string) {
  await serverRow(page, name).click()
  await page.getByRole('heading', { name, exact: true }).waitFor({ timeout: UI_TIMEOUT_MS })
}

async function backToServers(page: Page) {
  await page.getByRole('button', { name: 'All servers' }).click()
  await serverList(page).waitFor({ timeout: UI_TIMEOUT_MS })
}

/** Checks the server's connection from its page unless the list already shows `status`. */
async function ensureChecked(page: Page, name: string, status: 'Connected' | 'Failed') {
  if ((await serverRow(page, name).getByText(status, { exact: true }).count()) > 0) return
  await openServer(page, name)
  await page.getByRole('button', { name: 'Check connection' }).click()
  await page
    .locator('h3', { hasText: name })
    .locator('xpath=..')
    .getByText(status, { exact: true })
    .waitFor({ timeout: CHECK_TIMEOUT_MS })
  await backToServers(page)
}

async function checkFixtureServers(context: CaptureContext) {
  await openMcpSettings(context)
  await ensureChecked(context.page, MCP_CONNECTED_SERVER, 'Connected')
  await ensureChecked(context.page, MCP_FAILING_SERVER, 'Failed')
}

/** The server list: one connected with its tool count, one failed, one waiting for a secret. */
export async function captureMcpServers(context: CaptureContext) {
  const { page } = context
  await checkFixtureServers(context)
  const heading = await regionOf(page.getByRole('heading', { name: 'Servers', exact: true }))
  const addServer = await regionOf(page.getByRole('button', { name: 'Add server' }))
  const list = await regionOf(serverList(page))
  await shootRegion(
    context,
    'mcp-servers.png',
    unionRegion([heading, addServer, list], CROP_MARGIN_PX),
  )
  await leaveSettings(page)
}

/** A connected server's page: where it is defined, its switches, exposure and tools. */
export async function captureMcpServerDetail(context: CaptureContext) {
  const { page } = context
  await checkFixtureServers(context)
  await openServer(page, MCP_CONNECTED_SERVER)
  await page.getByText('draft_release_notes').waitFor({ timeout: UI_TIMEOUT_MS })
  const top = await regionOf(page.getByRole('button', { name: 'All servers' }))
  const check = await regionOf(page.getByRole('button', { name: 'Check connection' }))
  const remove = await regionOf(page.getByRole('button', { name: 'Remove' }))
  await shootRegion(
    context,
    'mcp-server-detail.png',
    unionRegion([top, check, remove], CROP_MARGIN_PX),
  )
  await backToServers(page)
  await leaveSettings(page)
}

/** A local server that exits at start: the connection error and the last lines it printed. */
export async function captureMcpServerError(context: CaptureContext) {
  const { page } = context
  await checkFixtureServers(context)
  await openServer(page, MCP_FAILING_SERVER)
  const output = page.getByLabel('Server output')
  await output.waitFor({ timeout: UI_TIMEOUT_MS })
  const top = await regionOf(page.getByRole('button', { name: 'All servers' }))
  const check = await regionOf(page.getByRole('button', { name: 'Check connection' }))
  await shootRegion(
    context,
    'mcp-server-error.png',
    unionRegion([top, check, await regionOf(output)], CROP_MARGIN_PX),
  )
  await backToServers(page)
  await leaveSettings(page)
}
