import { describe, expect, it } from 'vitest'
import {
  applyPreparedEnvironment,
  capturePreparedEnvironment,
  withoutWorkspaceContext,
} from '../prepared-environment'

describe('prepared environment changes', () => {
  it('captures removed inherited variables, new and empty values without storing unchanged secrets', () => {
    expect(
      capturePreparedEnvironment(
        { HTTPS_PROXY: 'inherited', TOKEN: 'private', PWD: '/before', SHLVL: '1' },
        {},
        { TOKEN: 'private', EMPTY: '', NEW: 'ready', PWD: '/after', SHLVL: '2' },
      ),
    ).toEqual({ HTTPS_PROXY: null, EMPTY: '', NEW: 'ready' })
  })

  it('retains removals across another successful setup and allows an explicit re-export', () => {
    const previous = { HTTPS_PROXY: null, OLD: 'removed', PWD: '/transient' }
    expect(capturePreparedEnvironment({}, previous, {})).toEqual({ HTTPS_PROXY: null, OLD: null })
    expect(capturePreparedEnvironment({}, previous, { HTTPS_PROXY: 'new' })).toEqual({
      HTTPS_PROXY: 'new',
      OLD: null,
    })
  })

  it('uses Windows case-insensitive names when capturing and applying changes', () => {
    const changes = capturePreparedEnvironment(
      { Path: 'same', Https_Proxy: 'remove' },
      {},
      { PATH: 'same', READY: '' },
      true,
    )
    expect(changes).toEqual({ Https_Proxy: null, READY: '' })
    expect(
      applyPreparedEnvironment({ PATH: 'same', HTTPS_PROXY: 'current' }, changes, true),
    ).toEqual({ PATH: 'same', READY: '' })
  })

  it('keeps distinct POSIX names and removes variables instead of passing a null string', () => {
    const inherited = { HTTPS_PROXY: 'remove', https_proxy: 'keep', OTHER: undefined }
    expect(applyPreparedEnvironment(inherited, { HTTPS_PROXY: null, NEW: '' })).toEqual({
      https_proxy: 'keep',
      OTHER: undefined,
      NEW: '',
    })
    expect(inherited.HTTPS_PROXY).toBe('remove')
  })

  it('never captures or applies prepared overrides of the current workspace context', () => {
    const baseline = {
      OPENWAGGLE_PROJECT_ROOT: '/old/project',
      OPENWAGGLE_WORKTREE_PATH: '/old/tree',
    }
    expect(
      capturePreparedEnvironment(
        baseline,
        { OPENWAGGLE_AGENT_RUN: 'wrong' },
        { OPENWAGGLE_PROJECT_ROOT: '/wrong/project', READY: 'yes' },
      ),
    ).toEqual({ READY: 'yes' })
    expect(
      applyPreparedEnvironment(
        { OPENWAGGLE_PROJECT_ROOT: '/current/project', OPENWAGGLE_WORKTREE_PATH: '/current/tree' },
        withoutWorkspaceContext({
          openwaggle_project_root: '/wrong/project',
          OPENWAGGLE_WORKTREE_PATH: null,
          READY: 'yes',
        }),
        true,
      ),
    ).toEqual({
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
      OPENWAGGLE_WORKTREE_PATH: '/current/tree',
      READY: 'yes',
    })
  })
})
