import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Script } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  annotating as annotatingWith,
  controlsState,
  evaluations,
  FRAME_WORLD,
  MAIN_WORLD,
  pickToken,
  report,
} from './electrobun-annotation-harness'
import { openPreview, settle, setup } from './electrobun-browser-preview-harness'
import { browserPreviewPickerScript } from '../electrobun-preview-page-script'
import { annotationPayload } from '../../../browser-preview/annotation/__tests__/browser-preview-annotation.test-fixtures'
import {
  BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
  BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT,
} from '../../../browser-preview/annotation/browser-preview-element-picker-script'
import { BrowserPreviewArtifactStorage } from '../../../browser-preview/browser-preview-artifact-storage'
import {
  configurePreparedAttachmentRegistry,
  resetPreparedAttachmentRegistryForTests,
} from '../../../../utils/attachment-registry'

vi.mock('../../../../desktop-native-admission', () => ({
  assertDesktopNativeAdmission: () => undefined,
}))

let root = ''

beforeEach(async () => {
  vi.useFakeTimers()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-electrobun-annotation-'))
  configurePreparedAttachmentRegistry(root)
})

afterEach(async () => {
  vi.useRealTimers()
  resetPreparedAttachmentRegistryForTests()
  await fs.rm(root, { recursive: true, force: true })
})

function annotating() {
  return annotatingWith(
    { storage: new BrowserPreviewArtifactStorage(path.join(root, 'artifacts')) },
    settle,
  )
}

describe('Electrobun Browser preview annotations', () => {
  it('wraps the shared picker in a script CEF can evaluate', () => {
    expect(
      () => new Script(browserPreviewPickerScript(BROWSER_PREVIEW_ELEMENT_PICKER_SCRIPT, 'token')),
    ).not.toThrow()
  })

  it('picks in the main frame world, decodes the result and attaches a screenshot of it', async () => {
    const harness = await annotating()
    harness.cef.respond('Page.getLayoutMetrics', () => ({
      cssVisualViewport: { pageX: 0, pageY: 100, clientWidth: 400, clientHeight: 300 },
    }))
    const payload = annotationPayload()

    const picked = harness.views.pickElement(harness.page.surface, 'p-1')
    await settle()
    const token = pickToken(harness)
    report(harness, FRAME_WORLD, { kind: 'pick', token, result: null })
    report(harness, MAIN_WORLD, { kind: 'pick', token, result: payload })
    await settle()

    const annotation = await picked
    expect(annotation).toMatchObject({
      previewId: 'p-1',
      pageUrl: payload.pageUrl,
      regions: payload.regions,
      attachment: { id: 'attachment-1', origin: 'browser-preview' },
    })
    expect(harness.prepareAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'browser-preview',
        browserAnnotationText: expect.stringContaining('Make this panel narrower.'),
      }),
    )
    // The viewport rectangle the picker reports, clipped in the scrolled document.
    expect(harness.cef.sent('Page.captureScreenshot').at(-1)?.params['clip']).toEqual({
      x: 0,
      y: 100,
      width: 80,
      height: 30,
      scale: 1,
    })
    expect(evaluations(harness)).toContainEqual(
      expect.objectContaining({
        contextId: MAIN_WORLD,
        expression: BROWSER_PREVIEW_ELEMENT_PICKER_CAPTURED_SCRIPT,
      }),
    )
    expect(controlsState(harness)).toContainEqual(
      expect.objectContaining({ controls: expect.objectContaining({ picking: true }) }),
    )
    expect(controlsState(harness).at(-1)).toMatchObject({ controls: { picking: false } })
  })

  it('refuses a malformed page-derived result before it captures anything', async () => {
    const harness = await annotating()
    const picked = harness.views.pickElement(harness.page.surface, 'p-1')
    const refused = expect(picked).rejects.toThrow('returned invalid data')
    await settle()

    report(harness, MAIN_WORLD, {
      kind: 'pick',
      token: pickToken(harness),
      result: { ...annotationPayload(), comment: 'x'.repeat(20_000), regions: 'everywhere' },
    })
    await settle()

    await refused
    expect(harness.cef.sent('Page.captureScreenshot')).toHaveLength(0)
  })

  it('fails a pick whose page sends a message larger than any annotation', async () => {
    const harness = await annotating()
    const picked = harness.views.pickElement(harness.page.surface, 'p-1')
    const refused = expect(picked).rejects.toThrow('larger than the preview allows')
    await settle()

    report(harness, MAIN_WORLD, {
      kind: 'pick',
      token: pickToken(harness),
      result: 'x'.repeat(600_000),
    })
    await settle()

    await refused
  })

  it('cancels an outstanding pick in the page and ignores its late result', async () => {
    const harness = await annotating()
    const picked = harness.views.pickElement(harness.page.surface, 'p-1')
    await settle()
    const token = pickToken(harness)

    const cancelled = harness.views.cancelPickElement(harness.page.surface, 'p-1')
    await settle()
    report(harness, MAIN_WORLD, { kind: 'pick', token, result: annotationPayload() })
    await settle()

    await expect(cancelled).resolves.toBeUndefined()
    await expect(picked).resolves.toBeNull()
    expect(evaluations(harness)).toContainEqual(
      expect.objectContaining({
        contextId: MAIN_WORLD,
        expression: BROWSER_PREVIEW_ELEMENT_PICKER_CANCEL_SCRIPT,
      }),
    )
    expect(harness.cef.sent('Page.captureScreenshot')).toHaveLength(0)
  })

  it('ends a pick as cancelled when its document goes away', async () => {
    const harness = await annotating()
    const picked = harness.views.pickElement(harness.page.surface, 'p-1')
    await settle()

    harness.cef.emit(harness.view, 'Runtime.executionContextDestroyed', {
      executionContextId: MAIN_WORLD,
    })
    await settle()

    await expect(picked).resolves.toBeNull()
  })

  it('refuses to pick before the page has a main frame world', async () => {
    const harness = setup()
    openPreview(harness)
    await settle()

    await expect(harness.views.pickElement(harness.page.surface, 'p-1')).rejects.toThrow(
      'still loading',
    )
  })
})
