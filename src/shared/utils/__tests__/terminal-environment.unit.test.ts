import { TERMINAL } from '@shared/constants/resource-limits'
import { safeDecodeUnknown } from '@shared/schema'
import { terminalEnvironmentSchema } from '@shared/schemas/terminal'
import {
  createProjectActionTerminalEnvironment,
  normalizeTerminalEnvironment,
  terminalEnvironmentsEqual,
} from '@shared/utils/terminal-environment'
import { describe, expect, it } from 'vitest'

describe('terminal environment launch context', () => {
  it('normalizes key order and compares environments by value', () => {
    const normalized = normalizeTerminalEnvironment({ ZED: 'last', ALPHA: 'first' })

    expect(Object.keys(normalized)).toEqual(['ALPHA', 'ZED'])
    expect(terminalEnvironmentsEqual(normalized, { ALPHA: 'first', ZED: 'last' })).toBe(true)
  })

  it('gives fixed action context precedence and removes stale local worktree values', () => {
    expect(
      createProjectActionTerminalEnvironment({
        projectRoot: '/current/project',
        overrides: {
          CUSTOM_ACTION_VALUE: 'kept',
          T3CODE_PROJECT_ROOT: '/stale/project',
          OPENWAGGLE_PROJECT_ROOT: '/stale/project',
          T3CODE_WORKTREE_PATH: '/stale/worktree',
          OPENWAGGLE_WORKTREE_PATH: '/stale/worktree',
        },
      }),
    ).toEqual({
      CUSTOM_ACTION_VALUE: 'kept',
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
      T3CODE_PROJECT_ROOT: '/current/project',
    })
  })

  it('sets T3-compatible and OpenWaggle worktree variables together', () => {
    expect(
      createProjectActionTerminalEnvironment({
        projectRoot: '/project',
        worktreePath: '/worktree',
      }),
    ).toEqual({
      OPENWAGGLE_PROJECT_ROOT: '/project',
      OPENWAGGLE_WORKTREE_PATH: '/worktree',
      T3CODE_PROJECT_ROOT: '/project',
      T3CODE_WORKTREE_PATH: '/worktree',
    })
  })
})

describe('terminalEnvironmentSchema', () => {
  it('accepts bounded environment overrides', () => {
    expect(
      safeDecodeUnknown(terminalEnvironmentSchema, {
        T3CODE_PROJECT_ROOT: '/project',
        EMPTY_VALUE: '',
      }).success,
    ).toBe(true)
  })

  it.each([
    { 'INVALID-NAME': 'value' },
    { 'BAD=NAME': 'value' },
    { NODE_OPTIONS: '--require /tmp/injected.cjs' },
    { VALID_NAME: 'value\0tail' },
  ])('rejects unsafe names and values: %j', (environment) => {
    expect(safeDecodeUnknown(terminalEnvironmentSchema, environment).success).toBe(false)
  })

  it('rejects excessive entry counts and aggregate bytes', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: TERMINAL.ENV_MAX_ENTRIES + 1 }, (_, index) => [
        `TERMINAL_VALUE_${String(index)}`,
        'value',
      ]),
    )
    const tooLarge = Object.fromEntries(
      Array.from({ length: TERMINAL.ENV_MAX_ENTRIES }, (_, index) => [
        `TERMINAL_VALUE_${String(index)}`,
        'x'.repeat(TERMINAL.ENV_VALUE_MAX_LENGTH),
      ]),
    )

    expect(safeDecodeUnknown(terminalEnvironmentSchema, tooMany).success).toBe(false)
    expect(safeDecodeUnknown(terminalEnvironmentSchema, tooLarge).success).toBe(false)
  })
})
