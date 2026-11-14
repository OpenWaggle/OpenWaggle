import { flagValue, hasFlag, PrScriptError, withoutFlag } from './cli'

const DEFAULT_BASE_BRANCH = 'main'
export const PULL_REQUEST_TEMPLATE_PATH = '.github/pull_request_template.md'

const TITLE_FLAGS = ['--title', '-t'] as const
const BODY_FILE_FLAGS = ['--body-file', '-F'] as const
const BASE_FLAGS = ['--base', '-B'] as const
/** Flags that would bypass the title, body or draft rules this wrapper enforces. */
const REFUSED_FLAGS = new Map([
  ['--body', 'Write the body to a file and pass --body-file <path>.'],
  ['-b', 'Write the body to a file and pass --body-file <path>.'],
  ['--fill', 'Pass --title and --body-file; the title is the squash commit subject.'],
  ['--fill-first', 'Pass --title and --body-file; the title is the squash commit subject.'],
  ['--fill-verbose', 'Pass --title and --body-file; the title is the squash commit subject.'],
  ['--web', 'Create the PR from the terminal so the wrapper can check it.'],
  ['-w', 'Create the PR from the terminal so the wrapper can check it.'],
  ['--template', `The wrapper checks the body against ${PULL_REQUEST_TEMPLATE_PATH}.`],
  ['-T', `The wrapper checks the body against ${PULL_REQUEST_TEMPLATE_PATH}.`],
])

export interface CreateRequest {
  readonly base: string
  readonly bodyFile: string
  /** Every other `gh pr create` flag, passed through unchanged (labels, reviewers, ...). */
  readonly passthrough: readonly string[]
  readonly title: string
}

function firstFlagValue(args: readonly string[], names: readonly string[]) {
  for (const name of names) {
    const value = flagValue(args, name)
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

function withoutFlags(args: readonly string[], names: readonly string[]) {
  return names.reduce<readonly string[]>((rest, name) => withoutFlag(rest, name), args)
}

function refusedFlag(args: readonly string[]) {
  return args
    .map((argument) => argument.split('=')[0] ?? argument)
    .find((argument) => REFUSED_FLAGS.has(argument))
}

export function parseCreateArgs(args: readonly string[]) {
  const refused = refusedFlag(args)
  if (refused !== undefined) {
    throw new PrScriptError(`${refused} is not supported. ${REFUSED_FLAGS.get(refused) ?? ''}`)
  }
  const title = firstFlagValue(args, TITLE_FLAGS)?.trim()
  if (title === undefined || title.length === 0) {
    throw new PrScriptError('--title is required; it becomes the squash commit subject.')
  }
  const bodyFile = firstFlagValue(args, BODY_FILE_FLAGS)
  if (bodyFile === undefined) {
    throw new PrScriptError(
      `--body-file is required; start from ${PULL_REQUEST_TEMPLATE_PATH} and fill it in.`,
    )
  }
  const base = firstFlagValue(args, BASE_FLAGS) ?? DEFAULT_BASE_BRANCH
  const passthrough = withoutFlags(args, [
    ...TITLE_FLAGS,
    ...BODY_FILE_FLAGS,
    ...BASE_FLAGS,
  ]).filter((argument) => argument !== '--draft' && argument !== '-d')
  return { base, bodyFile, passthrough, title }
}

export function buildGhCreateArgs(request: CreateRequest) {
  return [
    'pr',
    'create',
    '--draft',
    '--base',
    request.base,
    '--title',
    request.title,
    '--body-file',
    request.bodyFile,
    ...request.passthrough,
  ]
}

const HEADING_PATTERN = /^##\s+(.+?)\s*$/gm

export function templateHeadings(template: string) {
  return [...template.matchAll(HEADING_PATTERN)].map((match) => match[1] ?? '')
}

/** Template `##` headings the body does not carry, so a PR cannot drop the release-notes sections. */
export function missingTemplateHeadings(template: string, body: string) {
  const present = new Set(templateHeadings(body).map((heading) => heading.toLowerCase()))
  return templateHeadings(template).filter((heading) => !present.has(heading.toLowerCase()))
}

export function isHelpRequest(args: readonly string[]) {
  return hasFlag(args, '--help', '-h')
}
