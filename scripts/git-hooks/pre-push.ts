/**
 * The pre-push hook (`.husky/pre-push`). git passes one line per ref it is about to update on
 * stdin: `<local ref> <local sha> <remote ref> <remote sha>`. A push that would drop commits
 * from the remote ref rewrites published history, so it is refused, with no prompt and no
 * override: the remote commit is not an ancestor of the pushed one, or the remote has a commit
 * this clone has never fetched (git refuses that push unless it is forced). Otherwise the hook
 * runs the fast verify, or the full gate for a push to `main`. Deleting a ref runs nothing.
 */
import { spawnSync } from 'node:child_process'

export interface RefUpdate {
  readonly localRef: string
  readonly localSha: string
  readonly remoteRef: string
  readonly remoteSha: string
}

export interface PushGit {
  /** Whether `sha` names a commit in this clone. */
  readonly commitExists: (sha: string) => boolean
  /** Whether `ancestor` is reachable from `descendant`. */
  readonly isAncestor: (ancestor: string, descendant: string) => boolean
}

export type PrePushPlan =
  | { readonly kind: 'reject'; readonly message: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'run'; readonly script: 'verify' | 'prepush:main' }

const ZERO_SHA = /^0+$/
const MAIN_REF = 'refs/heads/main'
const REF_UPDATE_FIELDS = 4
const GIT_ENVIRONMENT = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']

export function parseRefUpdates(stdin: string) {
  return stdin.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== REF_UPDATE_FIELDS) {
      return []
    }
    const [localRef = '', localSha = '', remoteRef = '', remoteSha = ''] = fields
    return [{ localRef, localSha, remoteRef, remoteSha }]
  })
}

/** What the hook does for these ref updates. */
export function planPrePush(updates: readonly RefUpdate[], git: PushGit) {
  const pushes = updates.filter((update) => !ZERO_SHA.test(update.localSha))
  const unknown = pushes.filter(
    (update) => !ZERO_SHA.test(update.remoteSha) && !git.commitExists(update.remoteSha),
  )
  const rewrites = pushes.filter(
    (update) =>
      !ZERO_SHA.test(update.remoteSha) &&
      git.commitExists(update.remoteSha) &&
      !git.isAncestor(update.remoteSha, update.localSha),
  )
  if (rewrites.length > 0) {
    return {
      kind: 'reject',
      message: `pre-push: refusing a force push to ${refList(rewrites)}: it drops commits from the remote. Push new commits on top instead (merge the base branch, or revert).`,
    } satisfies PrePushPlan
  }
  if (unknown.length > 0) {
    return {
      kind: 'reject',
      message: `pre-push: the remote ${refList(unknown)} has commits this clone has not fetched. Fetch and merge them, then push again.`,
    } satisfies PrePushPlan
  }
  if (pushes.length === 0) {
    return { kind: 'skip' } satisfies PrePushPlan
  }
  return {
    kind: 'run',
    script: pushes.some((update) => update.remoteRef === MAIN_REF) ? 'prepush:main' : 'verify',
  } satisfies PrePushPlan
}

function refList(updates: readonly RefUpdate[]) {
  return updates.map((update) => update.remoteRef).join(', ')
}

/** The real repository at `cwd`. */
export function localPushGit(cwd = process.cwd()) {
  const succeeds = (args: readonly string[]) =>
    spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0
  return {
    commitExists: (sha) => succeeds(['cat-file', '-e', `${sha}^{commit}`]),
    isAncestor: (ancestor, descendant) =>
      succeeds(['merge-base', '--is-ancestor', ancestor, descendant]),
  } satisfies PushGit
}

async function readStdin() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const plan = planPrePush(parseRefUpdates(await readStdin()), localPushGit())
  if (plan.kind === 'reject') {
    console.error(plan.message)
    process.exitCode = 1
    return
  }
  if (plan.kind === 'skip') {
    return
  }
  console.log(`pre-push: bun run ${plan.script}`)
  // A linked worktree's hook gets an absolute GIT_DIR, which breaks any child that runs git in
  // its own temporary repository (commit-policy and worktree fixtures), so drop git's variables.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !GIT_ENVIRONMENT.includes(name)),
  )
  const result = spawnSync('bun', ['run', plan.script], { stdio: 'inherit', env })
  process.exitCode = result.status ?? 1
}

if (import.meta.main) {
  await main()
}
