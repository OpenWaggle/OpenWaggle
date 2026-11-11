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
})
