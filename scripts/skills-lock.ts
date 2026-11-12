/**
 * Vendored skills lock (`skills-lock.json`).
 *
 *   bun scripts/skills-lock.ts [check]
 *   bun scripts/skills-lock.ts record <skill...|--all> [--reason <text>] [--fetch]
 *   bun scripts/skills-lock.ts drift [skill...]
 *
 * `check` verifies the lock offline; `bun run check:repository-standards` runs the same check.
 * `record` stores the current local hash of each named skill and, with `--reason`, why it differs
 * from upstream; `--fetch` also recomputes each upstream hash at its pinned ref (network). To add a
 * vendored skill, write its entry by hand with `hash` and each upstream `hash` set to "sha256-",
 * then run `record <skill> --fetch`.
 * `drift` fetches each upstream's default branch and reports the vendored skills whose upstream
 * files changed, moved or disappeared since the pinned ref. It needs the network and never runs
 * in `check`.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { match } from '@diegogbrisa/ts-match'
import {
  claimSkillFiles,
  collectSkillsLockViolations,
  decodeSkillsLock,
  hashSkillFiles,
  isPristineSkill,
  readSkillDirectories,
  SKILLS_DIRECTORY,
  SKILLS_LOCK_FILE,
  type SkillFiles,
  type SkillsLock,
  type SkillUpstream,
  type VendoredSkill,
} from './standards/skills-lock'

const REPOSITORY_ROOT = path.join(import.meta.dirname, '..')
const CACHE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'node_modules',
  '.cache',
  'openwaggle',
  'skills-upstream',
)
const SCRIPT_ARGUMENTS_START = 2
const SHORT_SHA_LENGTH = 12
const JSON_INDENT = 2
const GIT_MAX_BUFFER = 256 * 1024 * 1024

function readLock(): SkillsLock {
  const decoded = decodeSkillsLock(
    readFileSync(path.join(REPOSITORY_ROOT, SKILLS_LOCK_FILE), 'utf8'),
  )
  if (!decoded.ok) {
    throw new Error(`${SKILLS_LOCK_FILE} is malformed:\n${decoded.issues.join('\n')}`)
  }
  return decoded.lock
}

function writeLock(lock: SkillsLock) {
  const sorted = Object.fromEntries(
    Object.entries(lock.skills).sort(([left], [right]) => left.localeCompare(right)),
  )
  const text = JSON.stringify({ ...lock, skills: sorted }, null, JSON_INDENT)
  writeFileSync(path.join(REPOSITORY_ROOT, SKILLS_LOCK_FILE), `${text}\n`)
}

function git(gitDirectory: string, args: readonly string[], input?: string) {
  const result = spawnSync('git', ['--git-dir', gitDirectory, ...args], {
    input,
    maxBuffer: GIT_MAX_BUFFER,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`)
  }
  return result.stdout
}

/** One bare cache repository per upstream, fetched one commit deep. */
function upstreamCache(repository: string) {
  const directory = path.join(
    CACHE_DIRECTORY,
    repository.replace(/^https:\/\//u, '').replace(/[^\w.-]+/gu, '_'),
  )
  mkdirSync(directory, { recursive: true })
  spawnSync('git', ['init', '--bare', '--quiet', directory])
  return directory
}

/** Fetches `ref` (a commit SHA or `HEAD`) and returns the commit SHA and its date. */
function fetchCommit(cache: string, repository: string, ref: string) {
  git(cache, ['fetch', '--quiet', '--depth=1', '--no-tags', repository, ref])
  const [sha = '', date = ''] = git(cache, ['log', '-1', '--format=%H %cs', 'FETCH_HEAD'])
    .toString()
    .trim()
    .split(' ')
  return { sha, date }
}

/** Upstream files at `commit`, relative to the upstream path, limited to its `files` list. */
function upstreamFiles(cache: string, commit: string, upstream: SkillUpstream): SkillFiles {
  const pathspec = upstream.path === '' ? [] : ['--', upstream.path]
  const entries = git(cache, ['ls-tree', '-r', '-z', commit, ...pathspec])
    .toString()
    .split('\0')
    .flatMap((line) => {
      const [meta = '', file = ''] = line.split('\t')
      if (meta.split(' ')[1] !== 'blob') return []
      const relative = upstream.path === '' ? file : file.slice(upstream.path.length + 1)
      return upstream.files === undefined || upstream.files.includes(relative)
        ? [{ file, relative }]
        : []
    })
  const files = new Map<string, string>()
  if (entries.length === 0) return files
  const output = git(
    cache,
    ['cat-file', '--batch'],
    entries.map((entry) => `${commit}:${entry.file}\n`).join(''),
  )
  let offset = 0
  for (const entry of entries) {
    const headerEnd = output.indexOf('\n', offset)
    const [, type, sizeText] = output.subarray(offset, headerEnd).toString().split(' ')
    if (type !== 'blob') throw new Error(`${entry.file} is missing at ${commit}`)
    const size = Number(sizeText)
    const start = headerEnd + 1
    files.set(entry.relative, output.subarray(start, start + size).toString('utf8'))
    offset = start + size + 1
  }
  return files
}

function fileHash(contents: string) {
  return hashSkillFiles(new Map([['file', contents]]))
}

function changedFiles(before: SkillFiles, after: SkillFiles) {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort()
  return names.flatMap((name) => {
    const old = before.get(name)
    const current = after.get(name)
    if (old === undefined) return [`+${name}`]
    if (current === undefined) return [`-${name}`]
    return fileHash(old) === fileHash(current) ? [] : [name]
  })
}

function describeUpstream(upstream: SkillUpstream) {
  const repository = upstream.repository.replace(/^https:\/\//u, '')
  return upstream.path === '' ? repository : `${repository} ${upstream.path}`
}

function drift(names: readonly string[]) {
  const lock = readLock()
  const selected = Object.entries(lock.skills).filter(
    ([name]) => names.length === 0 || names.includes(name),
  )
  const lines: string[] = []
  let unchanged = 0
  let changed = 0
  let missing = 0
  for (const [name, skill] of selected) {
    for (const upstream of skill.upstream) {
      const cache = upstreamCache(upstream.repository)
      fetchCommit(cache, upstream.repository, upstream.ref)
      const pinned = upstreamFiles(cache, upstream.ref, upstream)
      const head = fetchCommit(cache, upstream.repository, 'HEAD')
      const current = upstreamFiles(cache, head.sha, upstream)
      const at = `HEAD ${head.sha.slice(0, SHORT_SHA_LENGTH)} (${head.date})`
      const where = `${name}: ${describeUpstream(upstream)}`
      if (current.size === 0) {
        missing += 1
        lines.push(`${where}: moved or removed at ${at}`)
        continue
      }
      if (hashSkillFiles(current) === upstream.hash) {
        unchanged += 1
        continue
      }
      changed += 1
      lines.push(`${where}: changed at ${at}: ${changedFiles(pinned, current).join(', ')}`)
    }
  }
  const total = unchanged + changed + missing
  console.log(
    `skills-lock drift: ${total} upstreams of ${selected.length} vendored skills; ${unchanged} unchanged, ${changed} changed, ${missing} moved or removed`,
  )
  for (const line of lines) console.log(line)
}

function fetchUpstreamHashes(skill: VendoredSkill): VendoredSkill {
  const [first, ...rest] = skill.upstream.map((upstream) => {
    const cache = upstreamCache(upstream.repository)
    fetchCommit(cache, upstream.repository, upstream.ref)
    const files = upstreamFiles(cache, upstream.ref, upstream)
    if (files.size === 0) {
      throw new Error(`${describeUpstream(upstream)} has no files at ${upstream.ref}`)
    }
    return { ...upstream, hash: hashSkillFiles(files) }
  })
  if (first === undefined) return skill
  return { ...skill, upstream: [first, ...rest] }
}

interface RecordOptions {
  readonly names: readonly string[]
  readonly all: boolean
  readonly reason: string | undefined
  readonly fetch: boolean
}

function parseRecordArguments(args: readonly string[]): RecordOptions {
  const names: string[] = []
  let reason: string | undefined
  let all = false
  let fetch = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) continue
    if (argument === '--all') {
      all = true
      continue
    }
    if (argument === '--fetch') {
      fetch = true
      continue
    }
    if (argument === '--reason') {
      index += 1
      reason = args[index]
      continue
    }
    names.push(argument)
  }
  return { names, all, reason, fetch }
}

function record(options: RecordOptions) {
  const lock = readLock()
  const directories = readSkillDirectories(REPOSITORY_ROOT)
  const names = options.all ? Object.keys(lock.skills) : options.names
  if (names.length === 0) throw new Error('Name the skills to record, or pass --all.')
  const skills = { ...lock.skills }
  for (const name of names) {
    const entry = skills[name]
    const files = directories.get(name)
    if (entry === undefined || files === undefined) {
      throw new Error(`${name} is not a vendored skill with a directory under ${SKILLS_DIRECTORY}.`)
    }
    const fetched = options.fetch ? fetchUpstreamHashes(entry) : entry
    const { localEdits: previousReason, ...base } = fetched
    const updated: VendoredSkill = { ...base, hash: hashSkillFiles(files) }
    const reason = options.reason ?? previousReason
    if (isPristineSkill(updated, files)) {
      skills[name] = updated
      continue
    }
    if (reason === undefined || reason.trim() === '') {
      const { unclaimed } = claimSkillFiles(updated, files)
      const additions = unclaimed.length > 0 ? ` (local files: ${unclaimed.join(', ')})` : ''
      throw new Error(`${name} differs from its upstream${additions}; pass --reason <why>.`)
    }
    skills[name] = { ...updated, localEdits: reason }
  }
  writeLock({ ...lock, skills })
  console.log(`skills-lock: recorded ${names.join(', ')}`)
}

function check() {
  const lock = readLock()
  const violations = collectSkillsLockViolations(lock, readSkillDirectories(REPOSITORY_ROOT))
  if (violations.length === 0) {
    console.log(`skills-lock: ${Object.keys(lock.skills).length} vendored skills match the lock`)
    return
  }
  for (const violation of violations) {
    const detail = violation.detail === undefined ? '' : ` (${violation.detail})`
    console.error(`${violation.file}: ${violation.message}${detail}`)
  }
  process.exitCode = 1
}

function main(args: readonly string[]) {
  const [command = 'check', ...rest] = args
  match(command)
    .with('check', () => check())
    .with('record', () => record(parseRecordArguments(rest)))
    .with('drift', () => drift(rest))
    .otherwise(() => {
      throw new Error(`Unknown command "${command}". Use check, record or drift.`)
    })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(SCRIPT_ARGUMENTS_START))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
