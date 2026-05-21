import { describe, expect, it } from 'vitest'
import { isRendererImportAllowed } from '../renderer-import-boundaries'

const PROJECT_ROOT = '/repo/src/renderer/src'

describe('renderer import boundaries', () => {
  it('allows a feature to import its own internals and shared modules', () => {
    const importer = `${PROJECT_ROOT}/features/chat/components/ChatPanel.tsx`

    expect(isRendererImportAllowed('../hooks/useChat', importer)).toBe(true)
    expect(isRendererImportAllowed('@/features/chat/lib/chat-message-text', importer)).toBe(true)
    expect(isRendererImportAllowed('@/shared/lib/cn', importer)).toBe(true)
  })

  it('allows cross-feature imports only through public feature API segments', () => {
    const importer = `${PROJECT_ROOT}/features/chat/components/ChatPanel.tsx`

    expect(isRendererImportAllowed('@/features/settings', importer)).toBe(true)
    expect(isRendererImportAllowed('@/features/settings/hooks', importer)).toBe(true)
    expect(isRendererImportAllowed('@/features/settings/hooks/useSettings', importer)).toBe(false)
    expect(isRendererImportAllowed('@/features/settings/state/preferences-store', importer)).toBe(false)
  })

  it('prevents shared modules from importing app features', () => {
    const importer = `${PROJECT_ROOT}/shared/lib/format.ts`

    expect(isRendererImportAllowed('@/shared/constants/ui', importer)).toBe(true)
    expect(isRendererImportAllowed('@/features/chat', importer)).toBe(false)
  })

  it('prevents imports from legacy renderer roots', () => {
    const importer = `${PROJECT_ROOT}/features/chat/components/ChatPanel.tsx`

    expect(isRendererImportAllowed('@/components/shared/Button', importer)).toBe(false)
    expect(isRendererImportAllowed('@/hooks/useMediaQuery', importer)).toBe(false)
    expect(isRendererImportAllowed('@/stores/ui-store', importer)).toBe(false)
  })

  it('allows route modules to compose shell, shared, and public feature modules', () => {
    const importer = `${PROJECT_ROOT}/routes/chat.tsx`

    expect(isRendererImportAllowed('@/shell', importer)).toBe(true)
    expect(isRendererImportAllowed('@/shell/ui-store', importer)).toBe(true)
    expect(isRendererImportAllowed('@/shell/Header', importer)).toBe(false)
    expect(isRendererImportAllowed('@/features/chat/components', importer)).toBe(true)
    expect(isRendererImportAllowed('@/features/chat/components/ChatPanel', importer)).toBe(false)
  })

  it('allows features to consume shell public contracts without importing shell surfaces', () => {
    const importer = `${PROJECT_ROOT}/features/chat/components/ChatPanel.tsx`

    expect(isRendererImportAllowed('@/shell/ui-store', importer)).toBe(true)
    expect(isRendererImportAllowed('@/shell/useFullscreen', importer)).toBe(true)
    expect(isRendererImportAllowed('@/shell/WorkspaceShell', importer)).toBe(false)
  })
})
