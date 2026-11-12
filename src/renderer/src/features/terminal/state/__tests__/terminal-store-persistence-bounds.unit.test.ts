import { TERMINAL } from '@shared/constants/resource-limits'
import { describe, expect, it } from 'vitest'
import { sanitizeStoredGroups } from '../terminal-store-persistence'

describe('sanitizeStoredGroups resource bounds', () => {
  it('keeps each terminal id in only one restored tab', () => {
    const input = {
      'session-1': {
        tabs: [
          { id: 'tab-1', panes: [{ terminalId: 'shared', cwd: '/repo' }] },
          {
            id: 'tab-2',
            panes: [
              { terminalId: 'shared', cwd: '/repo' },
              { terminalId: 'unique', cwd: '/repo' },
            ],
          },
        ],
        activeTabId: 'tab-2',
      },
    }

    expect(sanitizeStoredGroups(input)['session-1']?.tabs).toMatchObject([
      { id: 'tab-1', panes: [{ terminalId: 'shared' }] },
      { id: 'tab-2', panes: [{ terminalId: 'unique' }] },
    ])
  })

  it('bounds groups, tabs, panes, identities, paths, and launch environments', () => {
    const tabs = Array.from({ length: TERMINAL.MAX_TABS_PER_GROUP + 8 }, (_, index) => ({
      id: `tab-${String(index)}`,
      panes: [{ terminalId: `terminal-${String(index)}`, cwd: '/repo' }],
    }))
    const groups = Object.fromEntries(
      Array.from({ length: TERMINAL.MAX_STORED_GROUPS + 8 }, (_, index) => [
        `session-${String(index)}`,
        { tabs },
      ]),
    )

    const result = sanitizeStoredGroups(groups)

    expect(Object.keys(result)).toHaveLength(TERMINAL.MAX_STORED_GROUPS)
    expect(result['session-0']?.tabs).toHaveLength(TERMINAL.MAX_TABS_PER_GROUP)

    const paneHeavy = sanitizeStoredGroups({
      panes: {
        tabs: [
          {
            id: 'tab',
            panes: Array.from({ length: TERMINAL.MAX_PANES_PER_TAB + 8 }, (_, index) => ({
              terminalId: `pane-${String(index)}`,
              cwd: '/repo',
            })),
          },
        ],
      },
    })
    expect(paneHeavy.panes?.tabs[0]?.panes).toHaveLength(TERMINAL.MAX_PANES_PER_TAB)

    const malformed = sanitizeStoredGroups({
      ['o'.repeat(TERMINAL.OWNER_KEY_MAX_LENGTH + 1)]: { tabs },
      valid: {
        tabs: [
          {
            id: 'tab',
            panes: [
              {
                terminalId: 'terminal',
                cwd: '/repo',
                launchEnv: Object.fromEntries(
                  Array.from({ length: TERMINAL.ENV_MAX_ENTRIES + 1 }, (_, index) => [
                    `KEY_${String(index)}`,
                    'value',
                  ]),
                ),
              },
              { terminalId: 'too-long', cwd: 'x'.repeat(TERMINAL.CWD_PATH_MAX_LENGTH + 1) },
            ],
            customName: 'x'.repeat(TERMINAL.TAB_NAME_MAX_LENGTH + 1),
          },
        ],
      },
    })
    expect(Object.keys(malformed)).toEqual(['valid'])
    expect(malformed.valid?.tabs[0]).toMatchObject({
      customName: null,
      panes: [{ terminalId: 'terminal', cwd: '/repo' }],
    })
    expect(malformed.valid?.tabs[0]?.panes[0]).not.toHaveProperty('launchEnv')
  })

  it('caps restored terminal identities per owner', () => {
    const tabs = Array.from({ length: TERMINAL.MAX_TERMINALS_PER_OWNER + 8 }, (_, index) => ({
      id: `tab-${String(index)}`,
      panes: [{ terminalId: `terminal-${String(index)}`, cwd: '/repo' }],
    }))

    const restored = sanitizeStoredGroups({ owner: { tabs } }).owner

    expect(restored?.tabs).toHaveLength(TERMINAL.MAX_TERMINALS_PER_OWNER)
    expect(restored?.tabs.at(-1)?.panes[0]?.terminalId).toBe(
      `terminal-${String(TERMINAL.MAX_TERMINALS_PER_OWNER - 1)}`,
    )
  })
})
