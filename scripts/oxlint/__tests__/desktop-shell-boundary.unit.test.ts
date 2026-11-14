import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { lintWithRule } from './lint-rule.ts'

const RULE = 'openwaggle/desktop-shell-boundary'

function lint(code: string, filename: string) {
  return lintWithRule(openwagglePlugin, RULE, code, filename)
}

describe('desktop shell boundary', () => {
  it('reports every form of Electron reference outside the shell adapters', () => {
    const sources = [
      "import { app } from 'electron'\nexport const value = app\n",
      "import type { WebContents } from 'electron'\nexport type Value = WebContents\n",
      "export { app } from 'electron'\n",
      "export const load = () => import('electron')\n",
      "export type App = import('electron').App\n",
      "export const electron = require('electron')\n",
      'export type Window = Electron.BrowserWindow\n',
      "import { autoUpdater } from 'electron-updater'\nexport const value = autoUpdater\n",
      "import { is } from '@electron-toolkit/utils'\nexport const value = is\n",
    ]
    for (const source of sources) {
      const messages = lint(source, 'src/main/ipc/example.ts')
      expect(messages, source).toHaveLength(1)
      expect(messages.at(0)?.message).toContain('Electron outside the desktop shell adapters')
    }
  })

  it('applies to tests, the preload and the renderer as well as main', () => {
    const source = "import type { WebContents } from 'electron'\nexport type Value = WebContents\n"
    for (const filename of [
      'src/main/ipc/__tests__/example.unit.test.ts',
      'src/preload/api.ts',
      'src/renderer/src/example.ts',
      'src/shared/example.ts',
    ]) {
      expect(lint(source, filename), filename).toHaveLength(1)
    }
  })

  it('allows the Electron adapters, the preload transport and the preload tests', () => {
    const source = "import { app } from 'electron'\nexport const value = app\n"
    for (const filename of [
      'src/main/adapters/electron/electron-app-paths.ts',
      'src/main/adapters/electron/browser-preview/browser-preview.ts',
      'src/main/adapters/electron/__tests__/electron-app-paths.unit.test.ts',
      'src/preload/electron-transport.ts',
      'src/preload/__tests__/api.unit.test.ts',
    ]) {
      expect(lint(source, filename), filename).toHaveLength(0)
    }
  })

  it('confines the Sentry Electron SDK to the crash-reporting bridges', () => {
    const source = "import { init } from '@sentry/electron/renderer'\nexport const value = init\n"
    expect(lint(source, 'src/renderer/src/shared/lib/sentry-renderer.ts')).toHaveLength(0)
    expect(lint(source, 'src/preload/error-reporting-bridge.ts')).toHaveLength(0)
    const messages = lint(source, 'src/renderer/src/features/chat/example.ts')
    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('ErrorReporter port')
  })

  it('ignores scripts, look-alike packages and mocks that import nothing', () => {
    expect(lint("import { app } from 'electron'\nexport const a = app\n", 'scripts/x.ts')).toEqual(
      [],
    )
    expect(
      lint("import x from 'electron-to-chromium'\nexport const a = x\n", 'src/main/x.ts'),
    ).toEqual([])
    expect(lint("vi.mock('electron', () => ({}))\n", 'src/main/__tests__/x.unit.test.ts')).toEqual(
      [],
    )
  })
})
