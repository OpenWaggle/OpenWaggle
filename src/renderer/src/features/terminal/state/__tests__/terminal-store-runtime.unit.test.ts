import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { runtimeKeyOf, terminalOwnerContext, terminalTabTitle } from '../../lib/terminal-owner'
import { useTerminalStore } from '../terminal-store'

const OWNER = 'owner-1'
const PREVIEW = { host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' }

function resetStore() {
  useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
}

function store() {
  return useTerminalStore.getState()
}
describe('terminal store runtime events', () => {
  it('applyRuntimeEvent records activity, verified previews, and exits under the runtime key', () => {
    resetStore()

    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'activity', processName: 'vite' })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'ports', ports: [5173, 3000] })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'port-previews', previews: [PREVIEW] })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'exited', exitCode: 2 })
    // Other owners must stay isolated.
    store().applyRuntimeEvent('owner-2', 'term-1', { type: 'activity', processName: 'x' })

    const state = store()
    const runtime = runtimeKeyOf(OWNER, 'term-1')
    expect(state.activity[runtime]).toBe('vite')
    expect(state.portPreviews[runtime]).toEqual([PREVIEW])
    expect(state.exits[runtime]).toBe(2)
    expect(state.activity[runtimeKeyOf('owner-2', 'term-1')]).toBe('x')
  })

  it('applyRuntimeEvent ignores output and cleared events', () => {
    resetStore()

    store().applyRuntimeEvent(OWNER, 'term-1', {
      type: 'output',
      data: 'hello',
      outputGeneration: 1,
      startOffset: 0,
      endOffset: 5,
    })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'cleared', outputGeneration: 1 })

    const state = store()
    expect(state.activity).toEqual({})
    expect(state.portPreviews).toEqual({})
    expect(state.exits).toEqual({})
  })

  it('replaces hidden-pane process and port metadata from a full main snapshot', () => {
    resetStore()
    store().applyRuntimeEvent(OWNER, 'stale', { type: 'activity', processName: 'old' })
    store().applyRuntimeSnapshot(
      [
        {
          ownerKey: OWNER,
          terminalId: 'term-1',
          activityStatus: 'running',
          processName: 'vite',
          ports: [5173],
          portPreviews: [PREVIEW],
          projectActionPending: false,
        },
      ],
      false,
    )

    expect(store().activity).toEqual({ [runtimeKeyOf(OWNER, 'term-1')]: 'vite' })
    expect(store().portPreviews).toEqual({ [runtimeKeyOf(OWNER, 'term-1')]: [PREVIEW] })
  })

  it('merges a truncated main snapshot without erasing omitted terminal metadata', () => {
    resetStore()
    store().applyRuntimeEvent(OWNER, 'omitted', { type: 'activity', processName: 'pnpm' })
    store().applyRuntimeEvent(OWNER, 'omitted', { type: 'port-previews', previews: [PREVIEW] })
    store().applyRuntimeSnapshot(
      [
        {
          ownerKey: OWNER,
          terminalId: 'visible',
          activityStatus: 'idle',
          processName: null,
          ports: [],
          projectActionPending: true,
        },
      ],
      true,
    )

    expect(store().activity).toEqual({
      [runtimeKeyOf(OWNER, 'omitted')]: 'pnpm',
      [runtimeKeyOf(OWNER, 'visible')]: null,
    })
    expect(store().portPreviews).toEqual({
      [runtimeKeyOf(OWNER, 'omitted')]: [PREVIEW],
      [runtimeKeyOf(OWNER, 'visible')]: [],
    })
  })

  it('clearExit removes only that terminal exit entry', () => {
    resetStore()
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'exited', exitCode: 1 })
    store().applyRuntimeEvent(OWNER, 'term-2', { type: 'exited', exitCode: 2 })

    store().clearExit(OWNER, 'term-1')

    const state = store()
    expect(state.exits[runtimeKeyOf(OWNER, 'term-1')]).toBeUndefined()
    expect(state.exits[runtimeKeyOf(OWNER, 'term-2')]).toBe(2)
  })
})
describe('terminalTabTitle', () => {
  const tab = (panes: string[], customName: string | null) => ({
    id: 'tab-1',
    panes: panes.map((terminalId) => ({ terminalId, cwd: '/repo' })),
    activePaneId: panes[0] ?? '',
    splitDirection: 'side-by-side' as const,
    customName,
  })

  it('prefers the custom name over everything', () => {
    const title = terminalTabTitle(OWNER, tab(['t1'], 'build'), 0, {
      [runtimeKeyOf(OWNER, 't1')]: 'vite',
    })

    expect(title).toBe('build')
  })

  it('falls back to the primary pane foreground process name', () => {
    expect(
      terminalTabTitle(OWNER, tab(['t1'], null), 0, {
        [runtimeKeyOf(OWNER, 't1')]: 'vite',
      }),
    ).toBe('vite')
  })

  it('ignores blank activity names and labels by index otherwise', () => {
    expect(terminalTabTitle(OWNER, tab(['t1'], null), 0, { [runtimeKeyOf(OWNER, 't1')]: '' })).toBe(
      'Terminal 1',
    )
    expect(terminalTabTitle(OWNER, tab(['t1'], null), 2, {})).toBe('Terminal 3')
  })
})

describe('runtimeKeyOf', () => {
  it('joins owner and terminal id with the canonical separator', () => {
    expect(runtimeKeyOf('session-1', 'term-9')).toBe('session-1::term-9')
  })
})

describe('terminalOwnerContext', () => {
  it('binds a session to its id and resolves local mode to the opened checkout', () => {
    const context = terminalOwnerContext(
      { id: SessionId('session-1'), environmentMode: 'local', projectPath: '/repo' },
      '/opened',
    )

    expect(context).toEqual({
      ownerKey: 'session-1',
      defaultCwd: '/repo',
      defaultProvenance: 'opened-checkout',
    })
  })

  it('resolves worktree mode to the Session worktree path', () => {
    const context = terminalOwnerContext(
      {
        id: SessionId('session-2'),
        environmentMode: 'worktree',
        worktreePath: '/repo/.worktrees/session-2',
        projectPath: '/repo',
      },
      '/opened',
    )

    expect(context).toEqual({
      ownerKey: 'session-2',
      defaultCwd: '/repo/.worktrees/session-2',
      defaultProvenance: 'session-worktree',
    })
  })

  it('falls back to the opened project when the session has no project path', () => {
    const context = terminalOwnerContext(
      { id: SessionId('session-3'), environmentMode: 'local', projectPath: null },
      '/opened',
    )

    expect(context).toEqual({
      ownerKey: 'session-3',
      defaultCwd: '/opened',
      defaultProvenance: 'opened-checkout',
    })
  })

  it('binds an unsent draft to the draft project path', () => {
    const context = terminalOwnerContext(null, '/tmp/project-x')

    expect(context).toEqual({
      ownerKey: 'draft:/tmp/project-x',
      defaultCwd: '/tmp/project-x',
      defaultProvenance: 'draft-checkout',
    })
  })

  it('has no owner without a project', () => {
    expect(terminalOwnerContext(null, null)).toEqual({
      ownerKey: '',
      defaultCwd: null,
      defaultProvenance: 'draft-checkout',
    })
  })
})
