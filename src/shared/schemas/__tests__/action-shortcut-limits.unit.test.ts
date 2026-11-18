import { decodeUnknownOrThrow } from '@shared/schema'
import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import { describe, expect, it } from 'vitest'
import { actionManifestSchema } from '../action-definitions'

const limit = PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT
const shortcut = { shortcut: { key: 'K', mod: true } }
const rules = (count: number) => Array.from({ length: count }, () => shortcut)
const action = (id: string, count: number) => ({
  id,
  name: id,
  icon: 'test',
  invocation: { type: 'command', command: 'echo ok', directory: '.' },
  kind: 'task',
  allowConcurrent: false,
  autoOpenPreview: false,
  shortcutRules: rules(count),
})
const manifest = (actions: readonly ReturnType<typeof action>[]) => ({
  version: 1,
  actions,
  profiles: [],
  preparation: [],
})

describe('native action shortcut boundaries', () => {
  it('accepts the project limit on one action and rejects one more rule', () => {
    expect(() =>
      decodeUnknownOrThrow(actionManifestSchema, manifest([action('one', limit)])),
    ).not.toThrow()
    expect(() =>
      decodeUnknownOrThrow(actionManifestSchema, manifest([action('one', limit + 1)])),
    ).toThrow()
  })

  it('enforces the same limit across actions in one project manifest', () => {
    expect(() =>
      decodeUnknownOrThrow(
        actionManifestSchema,
        manifest([action('one', limit / 2), action('two', limit / 2)]),
      ),
    ).not.toThrow()
    expect(() =>
      decodeUnknownOrThrow(
        actionManifestSchema,
        manifest([action('one', limit / 2), action('two', limit / 2 + 1)]),
      ),
    ).toThrow(/at most/)
  })
})
