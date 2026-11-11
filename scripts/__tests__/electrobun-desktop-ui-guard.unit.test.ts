import { describe, expect, it } from 'vitest'
import { collectUnguardedDesktopUiViolations } from '../check-repository-standards'

describe('Electrobun desktop UI guard', () => {
  it('rejects Electrobun desktop UI outside its automation-checked adapters', () => {
    const source = [
      'electrobun().Utils.showMessageBox({ message: "Continue?" })',
      'sdk.ContextMenu.showContextMenu(items)',
    ].join('\n')
    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', source)).toHaveLength(2)
    expect(
      collectUnguardedDesktopUiViolations(
        'src/main/adapters/electrobun/electrobun-menus.ts',
        source,
      ),
    ).toEqual([])
  })

  it('rejects Electrobun windows constructed or revealed outside the window policy', () => {
    const source = [
      'const window = new (electrobun().BrowserWindow)({ url })',
      'appWindow.activate()',
      'mainWindow.unminimize()',
    ].join('\n')
    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', source)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('window construction') }),
      expect.objectContaining({ message: expect.stringContaining('BrowserWindow reveal') }),
    ])
    expect(
      collectUnguardedDesktopUiViolations(
        'src/main/adapters/electrobun/electrobun-window-policy.ts',
        source,
      ),
    ).toEqual([])
  })
})
