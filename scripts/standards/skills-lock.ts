import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  decodeUnknownExactOrThrow,
  getParseIssues,
  parseJsonUnknown,
  Schema,
} from '../../src/shared/schema'
import type { Violation } from './violation'

/**
 * Vendored agent skills are pinned in `skills-lock.json`. Each vendored skill names the upstream
 * repository, path and commit it came from, the content hash of those upstream files at that
 * commit, and the content hash of the local copy. A local copy that differs from its upstream must
 * say why in `localEdits`; any later edit changes the local hash, so it has to be recorded again
 * (`bun scripts/skills-lock.ts record <skill>`). The check needs no network: upstream hashes are
 * recorded when the lock is written, and `bun scripts/skills-lock.ts drift` compares them with
 * each upstream's current default branch on demand.
 *
 * A content hash is the sha256 of one `<file sha256>  <relative path>` line per file, sorted by
 * path. File text is hashed with LF line endings and without trailing newlines, so a checkout's
 * line-ending conversion or an editor's final newline does not count as an edit.
 */
export const SKILLS_LOCK_FILE = 'skills-lock.json'
export const SKILLS_DIRECTORY = '.agents/skills'
const HASH_PREFIX = 'sha256-'
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const HTTPS_REPOSITORY = /^https:\/\/[^/\s]+\/[^\s]+[^/\s]$/u
/** Files an editor, OS or Python leaves in a skill directory that are not part of the skill. */
const IGNORED_ENTRIES = new Set(['.DS_Store', '__pycache__'])

const SkillUpstreamSchema = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  ref: Schema.String,
  files: Schema.optional(Schema.Array(Schema.String)),
  hash: Schema.String,
})

const VendoredSkillSchema = Schema.Struct({
  upstream: Schema.NonEmptyArray(SkillUpstreamSchema),
  hash: Schema.String,
  localEdits: Schema.optional(Schema.String),
})

const SkillsLockSchema = Schema.Struct({
  lockfileVersion: Schema.Literal(1),
  firstParty: Schema.Array(Schema.String),
  skills: Schema.Record({ key: Schema.String, value: VendoredSkillSchema }),
})

export type SkillUpstream = Schema.Schema.Type<typeof SkillUpstreamSchema>
export type VendoredSkill = Schema.Schema.Type<typeof VendoredSkillSchema>
export type SkillsLock = Schema.Schema.Type<typeof SkillsLockSchema>
/** A skill directory's files: relative path to text. */
export type SkillFiles = ReadonlyMap<string, string>

export type SkillsLockDecodeResult =
  | { readonly ok: true; readonly lock: SkillsLock }
  | { readonly ok: false; readonly issues: readonly string[] }

export function decodeSkillsLock(raw: string): SkillsLockDecodeResult {
  try {
    return { ok: true, lock: decodeUnknownExactOrThrow(SkillsLockSchema, parseJsonUnknown(raw)) }
  } catch (error) {
    const issues = getParseIssues(error)
    if (issues !== null) return { ok: false, issues }
    if (error instanceof SyntaxError) return { ok: false, issues: [error.message] }
    throw error
  }
}

export function normalizeSkillText(contents: string) {
  return contents.replace(/\r\n/gu, '\n').replace(/\n+$/u, '')
}

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

export function hashSkillFiles(files: SkillFiles) {
  const lines = [...files.keys()]
    .sort()
    .map((file) => `${sha256(normalizeSkillText(files.get(file) ?? ''))}  ${file}\n`)
  return `${HASH_PREFIX}${sha256(lines.join(''))}`
}

/**
 * Which local files each upstream covers. An upstream with a `files` list covers those files;
 * the one upstream without a list covers every other file. Files no upstream covers are local
 * additions.
 */
export function claimSkillFiles(skill: VendoredSkill, files: SkillFiles) {
  const claimed = skill.upstream.map(() => new Map<string, string>())
  const unclaimed: string[] = []
  const wholeDirectory = skill.upstream.findIndex((upstream) => upstream.files === undefined)
  for (const [file, contents] of files) {
    const listed = skill.upstream.findIndex((upstream) => upstream.files?.includes(file) === true)
    const owner = listed === -1 ? wholeDirectory : listed
    const target = claimed[owner]
    if (target === undefined) unclaimed.push(file)
    else target.set(file, contents)
  }
  return { claimed, unclaimed }
}

/** Whether the local copy is byte-for-byte (after text normalization) its upstream files. */
export function isPristineSkill(skill: VendoredSkill, files: SkillFiles) {
  const { claimed, unclaimed } = claimSkillFiles(skill, files)
  return (
    unclaimed.length === 0 &&
    skill.upstream.every((upstream, index) => {
      const covered = claimed[index]
      return covered !== undefined && hashSkillFiles(covered) === upstream.hash
    })
  )
}

function lockViolation(message: string, detail?: string): Violation {
  return detail === undefined
    ? { file: SKILLS_LOCK_FILE, message }
    : { file: SKILLS_LOCK_FILE, message, detail }
}

function upstreamShapeViolations(name: string, skill: VendoredSkill): Violation[] {
  const violations: Violation[] = []
  if (skill.upstream.filter((upstream) => upstream.files === undefined).length > 1) {
    violations.push(lockViolation('At most one upstream of a skill may omit its files list.', name))
  }
  for (const upstream of skill.upstream) {
    const where = `${name}: ${upstream.repository}`
    if (!HTTPS_REPOSITORY.test(upstream.repository)) {
      violations.push(lockViolation('An upstream repository is an https URL.', where))
    }
    if (!COMMIT_SHA.test(upstream.ref)) {
      violations.push(lockViolation('An upstream ref is a full 40-character commit SHA.', where))
    }
    if (upstream.path.startsWith('/') || upstream.path.endsWith('/')) {
      violations.push(
        lockViolation(
          'An upstream path is repository-relative without slashes at its ends.',
          where,
        ),
      )
    }
    if (upstream.path === '' && upstream.files === undefined) {
      violations.push(lockViolation('An upstream at the repository root lists its files.', where))
    }
    if (!upstream.hash.startsWith(HASH_PREFIX)) {
      violations.push(lockViolation(`An upstream hash starts with "${HASH_PREFIX}".`, where))
    }
  }
  return violations
}

function vendoredSkillViolations(name: string, skill: VendoredSkill, files: SkillFiles) {
  const violations = upstreamShapeViolations(name, skill)
  const recordCommand = `bun scripts/skills-lock.ts record ${name} --reason "<why>"`
  if (hashSkillFiles(files) !== skill.hash) {
    violations.push(
      lockViolation(
        `A vendored skill changed since its lock entry was recorded. If the edit is intentional, record it with \`${recordCommand}\`.`,
        name,
      ),
    )
    return violations
  }
  const reason = skill.localEdits?.trim() ?? ''
  const pristine = isPristineSkill(skill, files)
  if (!pristine && reason === '') {
    violations.push(
      lockViolation(
        `A vendored skill differs from its upstream without a recorded reason. Say why in localEdits with \`${recordCommand}\`.`,
        name,
      ),
    )
  }
  if (pristine && skill.localEdits !== undefined) {
    violations.push(
      lockViolation('A vendored skill matches its upstream; remove its stale localEdits.', name),
    )
  }
  return violations
}

function listedNameViolations(lock: SkillsLock, directories: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = []
  const vendored = new Set(Object.keys(lock.skills))
  const sorted = [...lock.firstParty].sort()
  if (lock.firstParty.some((name, index) => name !== sorted[index])) {
    violations.push(lockViolation('firstParty is sorted.'))
  }
  if (new Set(lock.firstParty).size !== lock.firstParty.length) {
    violations.push(lockViolation('firstParty lists each skill once.'))
  }
  for (const name of lock.firstParty) {
    if (vendored.has(name)) {
      violations.push(lockViolation('A skill is either first-party or vendored, not both.', name))
    }
  }
  for (const name of [...vendored, ...lock.firstParty]) {
    if (!directories.has(name)) {
      violations.push(
        lockViolation(`The lock lists a skill with no directory under ${SKILLS_DIRECTORY}.`, name),
      )
    }
  }
  for (const name of directories) {
    if (!vendored.has(name) && !lock.firstParty.includes(name)) {
      violations.push({
        file: `${SKILLS_DIRECTORY}/${name}`,
        message: `List every skill in ${SKILLS_LOCK_FILE}: under firstParty when this repository wrote it, or under skills with its upstream when it was copied from elsewhere.`,
      })
    }
  }
  return violations
}

export function collectSkillsLockViolations(
  lock: SkillsLock,
  skills: ReadonlyMap<string, SkillFiles>,
): Violation[] {
  const violations = listedNameViolations(lock, new Set(skills.keys()))
  for (const [name, skill] of Object.entries(lock.skills)) {
    const files = skills.get(name)
    if (files !== undefined) violations.push(...vendoredSkillViolations(name, skill, files))
  }
  return violations
}

function readDirectoryFiles(root: string, relative: string, files: Map<string, string>) {
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (IGNORED_ENTRIES.has(entry.name) || entry.name.endsWith('.pyc')) continue
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      readDirectoryFiles(root, child, files)
      continue
    }
    if (entry.isFile()) files.set(child, readFileSync(path.join(root, child), 'utf8'))
  }
}

export function readSkillFiles(skillDirectory: string): SkillFiles {
  const files = new Map<string, string>()
  readDirectoryFiles(skillDirectory, '', files)
  return files
}

/** Every skill directory under `.agents/skills`, by name. */
export function readSkillDirectories(repositoryRoot: string) {
  const directory = path.join(repositoryRoot, SKILLS_DIRECTORY)
  const skills = new Map<string, SkillFiles>()
  for (const name of readdirSync(directory).sort()) {
    const skillDirectory = path.join(directory, name)
    if (statSync(skillDirectory).isDirectory()) skills.set(name, readSkillFiles(skillDirectory))
  }
  return skills
}

/** The repository-standards entry point: the lock and every skill directory, read from disk. */
export function collectRepositorySkillsLockViolations(repositoryRoot: string): Violation[] {
  const decoded = decodeSkillsLock(
    readFileSync(path.join(repositoryRoot, SKILLS_LOCK_FILE), 'utf8'),
  )
  if (!decoded.ok) {
    return decoded.issues.map((issue) => lockViolation('The skills lock is malformed.', issue))
  }
  return collectSkillsLockViolations(decoded.lock, readSkillDirectories(repositoryRoot))
}
