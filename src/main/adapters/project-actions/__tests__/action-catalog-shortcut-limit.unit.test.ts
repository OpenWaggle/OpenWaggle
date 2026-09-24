import { decodeUnknownExactOrThrow } from '@shared/schema'
import { actionManifestSchema } from '@shared/schemas/action-definitions'
import type { ActionDefinition, ActionManifest } from '@shared/types/action-definitions'
import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import { describe, expect, it } from 'vitest'
import {
  editActionCatalog,
  type LocalActionDocument,
  resolveActionCatalog,
} from '../../../domain/project-action-catalog'

const limit = PROJECT_ACTION_LIMITS.SHORTCUT_RULES_PER_PROJECT
const shortcut = { shortcut: { key: 'K', mod: true } }

function action(id: string, count: number): ActionDefinition {
  return {
    id,
    name: id,
    icon: 'test',
    invocation: { type: 'command', command: 'echo ok', directory: '.' },
    kind: 'task',
    allowConcurrent: false,
    autoOpenPreview: false,
    shortcutRules: Array.from({ length: count }, () => shortcut),
  }
}

function manifest(actions: readonly ActionDefinition[]): ActionManifest {
  return { version: 1, actions, profiles: [], preparation: [] }
}

function document(actions: readonly ActionDefinition[]): LocalActionDocument {
  return {
    manifest: manifest(actions),
    reviews: [],
    migration: { version: 1, legacySource: null },
  }
}

describe('effective native action shortcut limit', () => {
  it('accepts the combined limit across distinct personal and shared actions', () => {
    const personal = document([action('personal', limit / 2)])
    const shared = manifest([action('shared', limit / 2)])

    expect(resolveActionCatalog(personal, shared, '').actions).toHaveLength(2)
  })

  it('rejects separately valid manifests whose effective rules exceed the project limit', () => {
    const personal = document([action('personal', limit / 2 + 1)])
    const shared = manifest([action('shared', limit / 2)])
    expect(() => decodeUnknownExactOrThrow(actionManifestSchema, personal.manifest)).not.toThrow()
    expect(() => decodeUnknownExactOrThrow(actionManifestSchema, shared)).not.toThrow()

    expect(() => resolveActionCatalog(personal, shared, '')).toThrow(/at most 256.*shortcut rules/)
  })

  it('counts a personal override once rather than counting its hidden shared definition', () => {
    const personal = document([action('same', limit)])
    const shared = manifest([action('same', limit)])

    expect(resolveActionCatalog(personal, shared, '').actions).toHaveLength(1)
  })

  it('rejects an edit that would exceed the effective limit without changing either source', () => {
    const personal = document([action('personal', limit / 2)])
    const shared = manifest([action('shared', limit / 2)])

    expect(() =>
      editActionCatalog(personal, shared, {
        type: 'save-action',
        storage: 'local',
        definition: action('extra', 1),
      }),
    ).toThrow(/at most 256.*shortcut rules/)
    expect(personal.manifest.actions).toHaveLength(1)
    expect(shared.actions).toHaveLength(1)
  })
})
