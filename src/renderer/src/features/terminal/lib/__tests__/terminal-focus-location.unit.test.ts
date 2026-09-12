import { beforeEach, describe, expect, it } from 'vitest'
import type { TerminalGroupState } from '../../state/terminal-store'
import {
  rememberTerminalLayoutFocus,
  resetTerminalLayoutFocusForTests,
  resolveTerminalCommandLayoutOwner,
} from '../terminal-focus-location'

function group(terminalId: string): TerminalGroupState {
  return {
    tabs: [
      {
        id: `tab:${terminalId}`,
        panes: [{ terminalId, cwd: '/repo' }],
        activePaneId: terminalId,
        splitDirection: 'side-by-side',
        customName: null,
      },
    ],
    activeTabId: `tab:${terminalId}`,
    panelOpen: true,
    panelHeight: 300,
  }
}

describe('terminal focus location retention', () => {
  beforeEach(resetTerminalLayoutFocusForTests)

  it('bounds remembered owners while retaining the most recent focus', () => {
    for (let index = 0; index < 129; index += 1) {
      rememberTerminalLayoutFocus(`owner:${index}`, `layout:${index}`)
    }
    const firstGroups = {
      'owner:0': group('base-first'),
      'layout:0': group('focused-first'),
    }
    const lastGroups = {
      'owner:128': group('base-last'),
      'layout:128': group('focused-last'),
    }

    expect(resolveTerminalCommandLayoutOwner('owner:0', firstGroups)).toBe('owner:0')
    expect(resolveTerminalCommandLayoutOwner('owner:128', lastGroups)).toBe('layout:128')
  })

  it('forgets a remembered layout once that layout no longer has tabs', () => {
    rememberTerminalLayoutFocus('owner', 'detached-layout')

    expect(resolveTerminalCommandLayoutOwner('owner', { owner: group('base') })).toBe('owner')
    expect(
      resolveTerminalCommandLayoutOwner('owner', {
        owner: group('base'),
        'detached-layout': group('late-tab'),
      }),
    ).toBe('owner')
  })
})
