import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { BrowserPreviewAutomationSnapshot } from '@shared/types/browser-preview-automation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { createBrowserPreviewAutomationExtension } from '../browser-preview-automation-extension'
import { createBrowserPreviewRuntimeResources } from '../pi-agent-kernel-run'

const status = {
  available: true,
  visible: true,
  tabId: 'tab-1',
  url: 'http://localhost:5173/',
  title: 'Application',
  loading: false,
  viewport: { mode: 'fill' as const },
  appearance: 'system' as const,
}

const snapshot: BrowserPreviewAutomationSnapshot = {
  url: status.url,
  title: status.title,
  loading: false,
  visibleText: 'Ready',
  interactiveElements: [],
  accessibilityTree: null,
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: { mimeType: 'image/png', data: 'cG5n', width: 800, height: 600 },
}

const service = fromPartial<BrowserPreviewAutomationServiceShape>({
  status: vi.fn(() => Effect.succeed(status)),
  navigate: vi.fn(() => Effect.succeed(status)),
  click: vi.fn(() => Effect.void),
  snapshot: vi.fn(() => Effect.succeed(snapshot)),
})

async function registeredTools() {
  const tools = new Map<string, ToolDefinition>()
  const factory = createBrowserPreviewAutomationExtension({
    scope: { sessionId: SessionId('session-1'), workingPath: '/project' },
    service,
  })
  await factory(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    }),
  )
  return tools
}

function context(confirm: ExtensionContext['ui']['confirm']) {
  return fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm } })
}

describe('Pi browser preview automation extension', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers the full collaborative preview tool contract', async () => {
    const tools = await registeredTools()

    expect([...tools.keys()]).toEqual([
      'preview_status',
      'preview_snapshot',
      'preview_open',
      'preview_navigate',
      'preview_resize',
      'preview_set_appearance',
      'preview_click',
      'preview_type',
      'preview_press',
      'preview_scroll',
      'preview_evaluate',
      'preview_wait_for',
      'preview_recording_start',
      'preview_recording_stop',
    ])
  })

  it('withholds both tools and instructions when agent browser access is disabled', () => {
    const disabled = createBrowserPreviewRuntimeResources({
      enabled: false,
      sessionId: SessionId('session-1'),
      workingPath: '/project',
      service,
    })
    const enabled = createBrowserPreviewRuntimeResources({
      enabled: true,
      sessionId: SessionId('session-1'),
      workingPath: '/project',
      service,
    })

    expect(disabled).toEqual({ trustedExtensionFactories: [], systemPromptAppendices: [] })
    expect(enabled.trustedExtensionFactories).toHaveLength(1)
    expect(enabled.systemPromptAppendices[0]).toContain('Start with preview_status')
    expect(enabled.systemPromptAppendices[0]).toContain('Do not switch to a global Playwright')
  })

  it('reports status without requesting page-control authority', async () => {
    const tools = await registeredTools()
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>()

    const result = await tools
      .get('preview_status')
      ?.execute('status-1', {}, undefined, undefined, context(confirm))

    expect(confirm).not.toHaveBeenCalled()
    expect(service.status).toHaveBeenCalledWith(
      { sessionId: SessionId('session-1'), workingPath: '/project' },
      {},
    )
    expect(result?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('http://localhost:5173/'),
    })
  })

  it('does not interact with the page after a denied approval', async () => {
    const tools = await registeredTools()
    const result = await tools.get('preview_click')?.execute(
      'click-1',
      { locator: 'role=button[name="Save"]' },
      undefined,
      undefined,
      context(async () => false),
    )

    expect(service.click).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true })
  })

  it('returns page inspection metadata and the PNG as native image content', async () => {
    const tools = await registeredTools()
    const result = await tools.get('preview_snapshot')?.execute(
      'snapshot-1',
      {},
      undefined,
      undefined,
      context(async () => true),
    )

    expect(service.snapshot).toHaveBeenCalledOnce()
    expect(result?.content).toEqual([
      { type: 'text', text: expect.not.stringContaining('cG5n') },
      { type: 'image', data: 'cG5n', mimeType: 'image/png' },
    ])
  })

  it('forwards navigation targets through the session-scoped service', async () => {
    const tools = await registeredTools()
    await tools.get('preview_navigate')?.execute(
      'navigate-1',
      { target: { kind: 'environment-port', port: 5173 } },
      undefined,
      undefined,
      context(async () => true),
    )

    expect(service.navigate).toHaveBeenCalledWith(
      { sessionId: SessionId('session-1'), workingPath: '/project' },
      { target: { kind: 'environment-port', port: 5173 } },
    )
  })
})
