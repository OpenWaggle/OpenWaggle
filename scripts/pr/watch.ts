import { setTimeout as sleep } from 'node:timers/promises'
import { Schema } from 'effect'
import {
  commandOutput,
  flagValue,
  hasFlag,
  normalizeArgs,
  PrScriptError,
  parseJson,
  reportFailure,
  runInherited,
} from './cli'
import { MAX_CHECK_ATTEMPTS } from './watch-checks'
import { fetchPullRequestState } from './watch-github'
import { buildSnapshot, isActionable, type WatchSnapshot } from './watch-snapshot'

const USER_ARGS_START_INDEX = 2
const DEFAULT_WATCH_SECONDS = 540
const POLL_INTERVAL_SECONDS = 45
const MS_PER_SECOND = 1000
const JSON_INDENT = 2
const VALUE_FLAGS = new Set(['--rerun-job', '--since', '--timeout'])

function printHelp() {
  console.log(`Usage: bun run pr:watch -- [pr] [mode]

Prints one JSON snapshot of a GitHub PR: checks on the head commit, bot reviews, open review
threads and comments, and the recommended actions. Read-only except --rerun-job.

  pr                   PR number, URL or branch; defaults to the current branch's PR
  --watch              Poll every ${String(POLL_INTERVAL_SECONDS)}s until an action other than wait comes up
  --since <signature>  With --watch: return as soon as the signature differs instead
  --timeout <seconds>  With --watch: give up after this long (default ${String(DEFAULT_WATCH_SECONDS)})
  --rerun-job <id>     Rerun one failed GitHub Actions job of the head commit
                       (at most ${String(MAX_CHECK_ATTEMPTS)} attempts per job per SHA)
  --force              With --rerun-job: go past that limit, only after the maintainer agreed`)
}

function positiveInteger(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PrScriptError(`${label} must be a positive integer, got "${value}".`)
  }
  return parsed
}

function resolvePrNumber(args: readonly string[]) {
  const selector = args.find(
    (argument, index) =>
      !argument.startsWith('-') && (index === 0 || !VALUE_FLAGS.has(args[index - 1] ?? '')),
  )
  const output = commandOutput('gh', [
    'pr',
    'view',
    ...(selector === undefined ? [] : [selector]),
    '--json',
    'number',
  ])
  return Schema.decodeUnknownSync(Schema.Struct({ number: Schema.Number }))(parseJson(output))
    .number
}

function takeSnapshot(prNumber: number) {
  return buildSnapshot(fetchPullRequestState(prNumber), Date.now())
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, JSON_INDENT))
}

async function watch(prNumber: number, seconds: number, since: string | undefined) {
  const done = (snapshot: WatchSnapshot) =>
    since === undefined ? isActionable(snapshot) : snapshot.signature !== since
  const deadline = Date.now() + seconds * MS_PER_SECOND
  let polls = 1
  let snapshot = takeSnapshot(prNumber)
  while (!done(snapshot) && Date.now() + POLL_INTERVAL_SECONDS * MS_PER_SECOND < deadline) {
    await sleep(POLL_INTERVAL_SECONDS * MS_PER_SECOND)
    snapshot = takeSnapshot(prNumber)
    polls += 1
  }
  print({ ...snapshot, watch: { polls, timedOut: !done(snapshot) } })
}

function rerunJob(prNumber: number, rawJobId: string, force: boolean) {
  const jobId = positiveInteger(rawJobId, '--rerun-job')
  const snapshot = takeSnapshot(prNumber)
  const check = [...snapshot.checks.failed].find((candidate) => candidate.id === jobId)
  if (check === undefined) {
    throw new PrScriptError(
      `Job ${String(jobId)} is not a failed required check of the head commit.`,
    )
  }
  if (check.retriesLeft === 0 && !force) {
    throw new PrScriptError(
      `${check.name} already ran ${String(check.attempts)} times on this SHA (max ${String(MAX_CHECK_ATTEMPTS)}). Ask the maintainer; pass --force once they agree.`,
    )
  }
  if (!runInherited('gh', ['run', 'rerun', '--job', String(jobId)])) {
    throw new PrScriptError(`gh run rerun --job ${String(jobId)} failed.`)
  }
  print({ attempt: check.attempts + 1, pr: snapshot.pr.url, rerun: check.name })
}

async function main() {
  const args = normalizeArgs(process.argv.slice(USER_ARGS_START_INDEX))
  if (hasFlag(args, '--help', '-h')) {
    printHelp()
    return
  }
  const prNumber = resolvePrNumber(args)
  const jobId = flagValue(args, '--rerun-job')
  if (jobId !== undefined) {
    rerunJob(prNumber, jobId, hasFlag(args, '--force'))
    return
  }
  if (hasFlag(args, '--watch')) {
    const timeout = flagValue(args, '--timeout')
    const seconds =
      timeout === undefined ? DEFAULT_WATCH_SECONDS : positiveInteger(timeout, '--timeout')
    await watch(prNumber, seconds, flagValue(args, '--since'))
    return
  }
  print(takeSnapshot(prNumber))
}

void main().catch((error: unknown) => {
  reportFailure('pr:watch', error)
})
