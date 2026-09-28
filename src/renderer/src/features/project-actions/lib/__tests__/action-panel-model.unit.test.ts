import { Schema } from '@shared/schema'
import type { ActionCatalog, DiscoveredProjectTask } from '@shared/types/action-definitions'
import { describe, expect, it } from 'vitest'
import { applyActionSource, applyScriptPick, displayedCommand } from '../action-draft-edits'
import { duplicateActionNames, duplicateNameHint } from '../action-names'
import { actionChanges, actionSummaryLine, actionSummarySentence } from '../action-panel-changes'
import {
  actionPanelDraftSchema,
  continueDraftLabel,
  draftBaseState,
  editActionDraft,
  isDraftDirty,
  newActionDraft,
  sameDefinition,
} from '../action-panel-drafts'
import {
  rankScripts,
  suggestActionIcon,
  suggestActionKind,
  suggestActionName,
} from '../action-panel-scripts'

function script(task: string, directory = '.', description = `run ${task}`): DiscoveredProjectTask {
  return {
    reference: {
      provider: 'package-script',
      source: directory === '.' ? 'package.json' : `${directory}/package.json`,
      task,
      directory,
    },
    group: directory === '.' ? 'root' : directory,
    description,
    runner: 'pnpm',
  }
}

const saved = {
  id: 'dev',
  name: 'Start dev server',
  icon: 'play',
  invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
  kind: 'service',
  allowConcurrent: false,
  autoOpenPreview: true,
} as const

function catalogWith(definition = saved): ActionCatalog {
  return {
    revision: 'r',
    actions: [{ source: 'local', definition }],
    profiles: [{ source: 'local', definition: { id: 'default', name: 'Default' } }],
    preparation: [],
  }
}

describe('action panel scripts', () => {
  it('ranks common scripts first, then project-root scripts, then shorter names', () => {
    const ranked = rankScripts([
      script('benchmark:session'),
      script('test', 'website'),
      script('lint'),
      script('dev', 'website'),
      script('dev'),
    ]).map(({ reference }) => `${reference.directory}:${reference.task}`)
    expect(ranked).toEqual([
      '.:dev',
      'website:dev',
      'website:test',
      '.:lint',
      '.:benchmark:session',
    ])
  })

  it('suggests readable names, naming the package for package scripts', () => {
    expect(suggestActionName(script('dev').reference)).toBe('Start dev server')
    expect(suggestActionName(script('dev', 'website').reference)).toBe('Start dev server (website)')
    expect(suggestActionName(script('test:unit', 'packages/core').reference)).toBe(
      'Test unit (core)',
    )
    expect(suggestActionName(script('typecheck').reference)).toBe('Check types')
  })

  it('suggests an icon and whether it keeps running from the script name', () => {
    expect(suggestActionIcon('test:e2e')).toBe('test')
    expect(suggestActionIcon('prepare:native')).toBe('configure')
    expect(suggestActionIcon('dev')).toBe('play')
    expect(suggestActionKind('dev')).toBe('service')
    expect(suggestActionKind('website:dev')).toBe('service')
    expect(suggestActionKind('test')).toBe('task')
  })
})

describe('action panel drafts', () => {
  it('treats a pristine new draft as nothing unfinished', () => {
    const draft = newActionDraft(true)
    expect(isDraftDirty(draft)).toBe(false)
    expect(isDraftDirty({ ...draft, definition: { ...draft.definition, name: 'Half done' } })).toBe(
      true,
    )
  })

  it('treats an unchanged edit as pristine regardless of key order', () => {
    const draft = editActionDraft({ source: 'local', definition: saved })
    const reordered = { ...draft, definition: { autoOpenPreview: true, ...draft.definition } }
    expect(isDraftDirty(reordered)).toBe(false)
    expect(sameDefinition({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(continueDraftLabel(draft)).toBe('Continue editing Start dev server')
  })

  it('notices when the saved action changed or disappeared after the draft began', () => {
    const draft = editActionDraft({ source: 'local', definition: saved })
    expect(draftBaseState(draft, catalogWith()).kind).toBe('current')
    const changed = { ...saved, invocation: { ...saved.invocation, command: 'pnpm dev --host' } }
    expect(draftBaseState(draft, catalogWith(changed))).toEqual({
      kind: 'changed',
      current: changed,
    })
    expect(draftBaseState(draft, { ...catalogWith(), actions: [] })).toEqual({ kind: 'removed' })
  })

  it('persists incomplete drafts but rejects unreadable ones', () => {
    const decode = Schema.decodeUnknownEither(actionPanelDraftSchema)
    expect(decode(newActionDraft(false))._tag).toBe('Right')
    expect(decode({ kind: 'action', definition: { id: '../bad' } })._tag).toBe('Left')
  })
})

describe('action panel edits', () => {
  it('fills smart defaults on a new action but never clobbers a name the user typed', () => {
    const picked = applyScriptPick(newActionDraft(true), script('dev').reference)
    expect(picked.definition).toMatchObject({
      name: 'Start dev server',
      kind: 'service',
      autoOpenPreview: true,
    })
    const repicked = applyScriptPick(picked, script('test').reference)
    expect(repicked.definition).toMatchObject({ name: 'Run tests', icon: 'test', kind: 'task' })
    const typed = { ...repicked, definition: { ...repicked.definition, name: 'My tests' } }
    expect(applyScriptPick(typed, script('lint').reference).definition.name).toBe('My tests')
  })

  it('never changes a saved action’s behaviour when a script is picked', () => {
    const draft = editActionDraft({ source: 'local', definition: saved })
    const picked = applyScriptPick(
      { ...draft, definition: { ...draft.definition, name: '' } },
      script('test').reference,
    )
    expect(picked.definition).toMatchObject({ name: 'Run tests', kind: 'service', icon: 'play' })
  })

  it('clears a linked script only when switching to the user’s own command', () => {
    const linked = applyScriptPick(newActionDraft(true), script('dev').reference)
    expect(applyActionSource(linked, 'command').definition.invocation).toEqual({
      type: 'command',
      command: '',
      directory: '.',
    })
    const copied = applyActionSource(linked, 'command', {
      type: 'command',
      command: 'pnpm run dev',
      directory: '.',
    })
    expect(copied.definition.invocation).toMatchObject({ command: 'pnpm run dev' })
    expect(
      displayedCommand(linked.definition.invocation, { tasks: [script('dev')], diagnostics: [] }),
    ).toBe('pnpm run dev')
  })
})

describe('action panel wording', () => {
  it('lists changes in plain words', () => {
    const changed = {
      ...saved,
      kind: 'task' as const,
      invocation: { ...saved.invocation, command: 'pnpm dev --host' },
    }
    expect(actionChanges(saved, changed)).toEqual([
      { label: 'Command', before: 'pnpm dev', after: 'pnpm dev --host' },
      { label: 'Runs', before: 'Keeps running until you stop it', after: 'Stops when it finishes' },
    ])
  })

  it('summarises what will happen in one line and one sentence', () => {
    const input = {
      name: 'Start dev server',
      command: 'pnpm run dev',
      directory: '.',
      kind: 'service' as const,
      allowConcurrent: false,
      autoOpenPreview: true,
      storage: 'local' as const,
      sharedEdit: false,
    }
    expect(actionSummaryLine(input)).toEqual({
      command: 'pnpm run dev',
      tail: ' · keeps running · only you',
    })
    const sentence = actionSummarySentence(input)
    expect(`${sentence.before}${sentence.command}${sentence.after}`).toBe(
      'Clicking “Start dev server” in + Action runs pnpm run dev in the project folder. It keeps running until you stop it and opens the browser preview when it is ready. Only you will have it. Saving does not run anything.',
    )
    expect(actionSummaryLine({ ...input, sharedEdit: true }).tail).toBe(
      ' · keeps running · only you get these changes',
    )
  })

  it('tells same-named actions apart without renaming them', () => {
    const shared = { source: 'project' as const, definition: { ...saved, id: 'shared' } }
    const website = {
      source: 'local' as const,
      definition: {
        ...saved,
        id: 'web',
        name: 'start DEV server',
        invocation: { type: 'command' as const, command: 'pnpm dev', directory: 'website' },
      },
    }
    expect(duplicateActionNames([shared, website])).toEqual(new Set(['start dev server']))
    expect(duplicateNameHint(shared)).toBe('shared')
    expect(duplicateNameHint(website)).toBe('website')
  })
})
