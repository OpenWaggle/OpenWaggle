import type {
  ActionDefinition,
  DiscoveredProjectTask,
  ProjectTaskReference,
} from '@shared/types/action-definitions'
import type { ProjectActionIcon } from '@shared/types/project-actions'
import { projectTaskArguments } from '@shared/utils/project-task-command'
import { resolvedActionCommand } from './native-action-display'

/** Scripts most people want first, in order. */
const COMMON_SCRIPTS = [
  'dev',
  'start',
  'test',
  'build',
  'lint',
  'typecheck',
  'check',
  'format',
  'preview',
]

/** Readable names for common scripts (ADR 0038); anything else gets its tidied script name. */
const READABLE_SCRIPT_NAMES: Readonly<Record<string, string>> = {
  dev: 'Start dev server',
  start: 'Start',
  serve: 'Start server',
  preview: 'Preview build',
  test: 'Run tests',
  build: 'Build',
  lint: 'Lint',
  typecheck: 'Check types',
  check: 'Run checks',
  format: 'Format code',
}

const ICON_RULES: readonly (readonly [RegExp, ProjectActionIcon])[] = [
  [/test|spec|e2e|vitest|jest/, 'test'],
  [/lint|check|format|typecheck|biome/, 'lint'],
  [/build|bundle|compile|package/, 'build'],
  [/debug|inspect/, 'debug'],
  [/prepare|setup|install|configure|generate|bootstrap/, 'configure'],
]
const LONG_RUNNING_SCRIPT = /^(dev|start|serve|watch|preview)(\b|:)|:(dev|watch|serve)$/

export function taskReferenceKey(reference: ProjectTaskReference) {
  return [
    reference.provider,
    reference.source,
    reference.task,
    reference.directory,
    reference.environment ?? '',
  ].join('\u0000')
}

export function sameTaskReference(left: ProjectTaskReference, right: ProjectTaskReference) {
  return taskReferenceKey(left) === taskReferenceKey(right)
}

/** The command a script runs, as the user would type it. Empty when its runner is unknown. */
export function scriptCommand(task: DiscoveredProjectTask) {
  if (!task.runner) return ''
  return resolvedActionCommand({
    type: 'executable',
    executable: task.runner,
    args: projectTaskArguments(task.reference),
    cwd: task.reference.directory,
  })
}

function commonRank(task: DiscoveredProjectTask) {
  const index = COMMON_SCRIPTS.indexOf(task.reference.task)
  return index < 0 ? COMMON_SCRIPTS.length : index
}

/** Common scripts first, then project-root scripts, then shorter names. */
export function rankScripts(tasks: readonly DiscoveredProjectTask[]) {
  return [...tasks].sort(
    (left, right) =>
      commonRank(left) - commonRank(right) ||
      Number(right.reference.directory === '.') - Number(left.reference.directory === '.') ||
      left.reference.task.length - right.reference.task.length ||
      left.reference.task.localeCompare(right.reference.task),
  )
}

export function filterScripts(tasks: readonly DiscoveredProjectTask[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return tasks
  return tasks.filter((task) =>
    [task.reference.task, task.description, task.group, task.reference.source]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}

function tidyScriptName(task: string) {
  const words = task.replace(/[:_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The package folder's last segment, for "Start dev server (website)". */
export function packageLabel(reference: ProjectTaskReference) {
  if (reference.directory === '.') return null
  return reference.directory.split('/').at(-1) ?? reference.directory
}

export function suggestActionName(reference: ProjectTaskReference) {
  const base = READABLE_SCRIPT_NAMES[reference.task] ?? tidyScriptName(reference.task)
  const label = packageLabel(reference)
  return label ? `${base} (${label})` : base
}

export function suggestActionIcon(task: string): ProjectActionIcon {
  return ICON_RULES.find(([rule]) => rule.test(task))?.[1] ?? 'play'
}

export function suggestActionKind(task: string): ActionDefinition['kind'] {
  return LONG_RUNNING_SCRIPT.test(task) ? 'service' : 'task'
}
