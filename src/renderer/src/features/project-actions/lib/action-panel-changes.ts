import type {
  ActionDefinition,
  ActionInvocation,
  ActionStorage,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import {
  folderLabel,
  PREVIEW_COPY,
  REPEAT_CLICK_COPY,
  RUN_BEHAVIOUR_COPY,
} from './action-panel-copy'
import type { DraftActionDefinition, DraftPreparationDefinition } from './action-panel-drafts'

type AnyInvocation = ActionInvocation | DraftActionDefinition['invocation']

export interface DefinitionChange {
  readonly label: string
  readonly before: string
  readonly after: string
}

export function invocationText(invocation: AnyInvocation) {
  return invocation.type === 'command'
    ? invocation.command.trim()
    : `the ${invocation.task.task} script in ${invocation.task.source}`
}

export function invocationDirectory(invocation: AnyInvocation) {
  return invocation.type === 'command' ? invocation.directory : invocation.task.directory
}

function shortcutText(definition: Pick<ActionDefinition, 'shortcutRules'>) {
  const rules = definition.shortcutRules ?? []
  if (rules.length === 0) return 'None'
  if (rules.length > 1) return `${String(rules.length)} shortcuts`
  return formatShortcutBinding(rules[0]?.shortcut ?? null)
}

function change(label: string, before: string, after: string): DefinitionChange[] {
  return before === after ? [] : [{ label, before, after }]
}

/** Plain-words differences, for "changed since you started" and agent proposals. */
export function actionChanges(
  before: ActionDefinition | DraftActionDefinition,
  after: ActionDefinition | DraftActionDefinition,
): readonly DefinitionChange[] {
  return [
    ...change('Name', before.name, after.name),
    ...change('Command', invocationText(before.invocation), invocationText(after.invocation)),
    ...change(
      'Folder',
      invocationDirectory(before.invocation),
      invocationDirectory(after.invocation),
    ),
    ...change('Runs', RUN_BEHAVIOUR_COPY[before.kind].short, RUN_BEHAVIOUR_COPY[after.kind].short),
    ...change(
      'Clicking it again',
      before.allowConcurrent ? REPEAT_CLICK_COPY.concurrent.short : REPEAT_CLICK_COPY.reuse.short,
      after.allowConcurrent ? REPEAT_CLICK_COPY.concurrent.short : REPEAT_CLICK_COPY.reuse.short,
    ),
    ...change(
      'Browser preview',
      before.autoOpenPreview ? PREVIEW_COPY.open.short : PREVIEW_COPY.manual.short,
      after.autoOpenPreview ? PREVIEW_COPY.open.short : PREVIEW_COPY.manual.short,
    ),
    ...change('Preview URL', before.previewUrl ?? 'Detected', after.previewUrl ?? 'Detected'),
    ...change('Icon', before.icon, after.icon),
    ...change('Keyboard shortcut', shortcutText(before), shortcutText(after)),
  ]
}

export function preparationChanges(
  before: PreparationDefinition | DraftPreparationDefinition,
  after: PreparationDefinition | DraftPreparationDefinition,
): readonly DefinitionChange[] {
  return [
    ...change('Command', invocationText(before.invocation), invocationText(after.invocation)),
    ...change(
      'Folder',
      invocationDirectory(before.invocation),
      invocationDirectory(after.invocation),
    ),
  ]
}

export interface ActionSummaryInput {
  readonly name: string
  readonly command: string
  readonly directory: string
  readonly kind: ActionDefinition['kind']
  readonly allowConcurrent: boolean
  readonly autoOpenPreview: boolean
  readonly storage: ActionStorage
  /** Editing a shared definition: storage decides who gets the changes. */
  readonly sharedEdit: boolean
}

function audience(storage: ActionStorage, sharedEdit: boolean) {
  if (sharedEdit)
    return storage === 'local' ? 'only you get these changes' : 'everyone gets these changes'
  return storage === 'local' ? 'only you' : 'everyone on the project'
}

/** "Runs pnpm run dev · keeps running · only you", with the command kept apart for code styling. */
export function actionSummaryLine(input: ActionSummaryInput) {
  const behaviour = input.kind === 'service' ? 'keeps running' : 'stops when done'
  return {
    command: input.command,
    tail: ` · ${behaviour} · ${audience(input.storage, input.sharedEdit)}`,
  }
}

export function actionSummarySentence(input: ActionSummaryInput) {
  const name = input.name.trim() ? `“${input.name.trim()}”` : 'this action'
  const behaviour =
    input.kind === 'service'
      ? `It keeps running until you stop it${input.autoOpenPreview ? ' and opens the browser preview when it is ready' : ''}.`
      : `It stops when it finishes${input.allowConcurrent ? ', and clicking it again starts another copy' : ''}.`
  const who = input.sharedEdit
    ? input.storage === 'local'
      ? 'Only you get these changes; everyone else keeps the shared version.'
      : 'Everyone on the project gets these changes once the file is committed.'
    : input.storage === 'local'
      ? 'Only you will have it.'
      : 'Everyone on the project gets it once the file is committed.'
  return {
    before: `Clicking ${name} in + Action runs `,
    command: input.command,
    after: ` in ${folderLabel(input.directory)}. ${behaviour} ${who} Saving does not run anything.`,
  }
}

export function preparationSummarySentence(input: {
  readonly phase: PreparationDefinition['phase']
  readonly command: string
  readonly directory: string
  readonly storage: ActionStorage
}) {
  const when =
    input.phase === 'setup'
      ? 'before the first message in each new worktree'
      : 'before a worktree is removed, while its files are still there'
  const who =
    input.storage === 'local'
      ? 'Only you have it.'
      : 'Teammates are asked to check it before it runs for them.'
  return {
    before: 'Runs ',
    command: input.command,
    after: ` in ${folderLabel(input.directory)} ${when}. ${who}`,
  }
}
