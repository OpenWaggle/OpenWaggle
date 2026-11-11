import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { lintWithRule } from './lint-rule.ts'

const RULE = 'openwaggle/desktop-shell-boundary'

function lint(code: string, filename: string) {
  return lintWithRule(openwagglePlugin, RULE, code, filename)
}

describe('desktop shell boundary', () => {
  it('reports every form of Electrobun SDK reference outside the shell adapters', () => {
    const sources = [
      "import { BrowserWindow } from 'electrobun/main'\nexport const value = BrowserWindow\n",
      "import type { BrowserWindow } from 'electrobun/main'\nexport type Value = BrowserWindow\n",
      "export { Utils } from 'electrobun/main'\n",
      "export const load = () => import('electrobun/main')\n",
      "export type Sdk = import('electrobun/main').BrowserWindow\n",
      "export const sdk = require('electrobun/main')\n",
      "import { Electroview } from 'electrobun/view'\nexport const value = Electroview\n",
    ]
    for (const source of sources) {
      const messages = lint(source, 'src/main/ipc/example.ts')
      expect(messages, source).toHaveLength(1)
      expect(messages.at(0)?.message).toContain(
        'Desktop shell SDK outside the desktop shell adapters',
      )
    }
  })

  it('applies to tests, the preload and the renderer as well as main', () => {
    const source = "import type { Utils } from 'electrobun/main'\nexport type Value = Utils\n"
    for (const filename of [
      'src/main/ipc/__tests__/example.unit.test.ts',
      'src/preload/api.ts',
      'src/renderer/src/example.ts',
      'src/shared/example.ts',
    ]) {
      expect(lint(source, filename), filename).toHaveLength(1)
    }
  })

  it('allows the Electrobun adapters and the preload transport alone', () => {
    const source = "import { Utils } from 'electrobun/main'\nexport const value = Utils\n"
    for (const filename of [
      'src/main/adapters/electrobun/electrobun-os-shell.ts',
      'src/main/adapters/electrobun/__tests__/electrobun-os-shell.unit.test.ts',
      'src/preload/transport.ts',
    ]) {
      expect(lint(source, filename), filename).toEqual([])
    }
  })

  it('confines the Sentry SDKs to the crash-reporting adapters', () => {
    const source = "import { init } from '@sentry/browser'\nexport const value = init\n"
    expect(lint(source, 'src/renderer/src/shared/lib/sentry-renderer.ts')).toHaveLength(0)
    const messages = lint(source, 'src/renderer/src/features/chat/example.ts')
    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.message).toContain('ErrorReporter port')
    const bun = "import { init } from '@sentry/bun'\nexport const value = init\n"
    expect(lint(bun, 'src/main/adapters/electrobun/sentry-bun-error-reporter.ts')).toEqual([])
    expect(lint(bun, 'src/main/error-reporting.ts')).toHaveLength(1)
  })

  it('ignores scripts, look-alike packages and mocks that import nothing', () => {
    expect(
      lint("import { Utils } from 'electrobun/main'\nexport const a = Utils\n", 'scripts/x.ts'),
    ).toEqual([])
    for (const lookAlike of ['electrobun-x', 'electron-to-chromium']) {
      expect(lint(`import x from '${lookAlike}'\nexport const a = x\n`, 'src/main/x.ts')).toEqual(
        [],
      )
    }
    expect(
      lint("vi.mock('electrobun/main', () => ({}))\n", 'src/main/__tests__/x.unit.test.ts'),
    ).toEqual([])
  })
})
