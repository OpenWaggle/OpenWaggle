import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { BrowserPreviewAutomationController } from '../../../browser-preview/automation/browser-preview-automation-control'
import { createBrowserPreviewAutomationPageFixture as createPage } from '../../../browser-preview/automation/__tests__/browser-preview-automation-control-test-harness'
import { browserPreviewAutomationPage } from '../browser-preview-automation-page'
import { BrowserPreviewControlOperations } from '../browser-preview-control-operations'
import type { BrowserPreviewRecord } from '../browser-preview-records'

describe('browser preview user controls', () => {
  it('shares one serialized CDP session with user appearance controls and releases it once', async () => {
    const { page, sendCommand } = createPage()
    const record = fromPartial<BrowserPreviewRecord>({
      previewId: 'preview-1',
      owner: { sender: fromPartial<WebContents>({ id: 42 }) },
      // The automation fixture is the CDP part of a WebContents.
      view: { webContents: fromAny<WebContents, unknown>(page.contents) },
    })
    const canonicalPage = browserPreviewAutomationPage(record)
    const controller = new BrowserPreviewAutomationController()
    const controls = new BrowserPreviewControlOperations(controller)

    await Promise.all([
      controls.setAppearance(canonicalPage.tabId, record.view.webContents, 'dark'),
      controller.run(canonicalPage, 'page-action', (context) => context.send('Page.getFrameTree')),
    ])

    expect(canonicalPage.tabId).toBe('42:preview-1')
    expect(page.contents.debugger.attach).toHaveBeenCalledOnce()
    expect(sendCommand.mock.calls.map(([method]) => method)).toEqual(
      expect.arrayContaining(['Emulation.setEmulatedMedia', 'Page.getFrameTree']),
    )

    controls.dispose(canonicalPage.tabId)
    expect(page.contents.debugger.detach).toHaveBeenCalledOnce()
  })
})
