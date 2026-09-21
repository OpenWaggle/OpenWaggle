import { runGit } from './run-git'
import { applyTreeDelta, indexTree, requiredGit, worktreeTree } from './workspace-handoff-git'

const ZERO_OBJECT_ID = '0'.repeat(40)

export interface WorkspaceHandoffSeed {
  readonly sourceHead: string
  readonly snapshotRef: string
}

function handoffRef(workspaceId: string) {
  return `refs/openwaggle/workspace-handoffs/${workspaceId}`
}

async function existingSeed(projectPath: string, workspaceId: string) {
  const snapshotRef = handoffRef(workspaceId)
  const current = await runGit(projectPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${snapshotRef}^{commit}`,
  ])
  if (current.code !== 0) return null
  const sourceHead = await requiredGit(
    projectPath,
    ['rev-parse', `${snapshotRef}^^`],
    'Reading handoff base',
  )
  return { sourceHead, snapshotRef } satisfies WorkspaceHandoffSeed
}

export async function captureWorkspaceHandoffSeed(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly workspaceId: string
}): Promise<WorkspaceHandoffSeed> {
  const retained = await existingSeed(input.projectPath, input.workspaceId)
  if (retained) return retained
  const sourceHead = await requiredGit(
    input.workingPath,
    ['rev-parse', '--verify', 'HEAD'],
    'Resolving Workspace HEAD',
  )
  const stagedTree = await indexTree(input.workingPath)
  const worktreeSnapshotTree = await worktreeTree(input.workingPath, stagedTree)
  const stagedCommit = await requiredGit(
    input.workingPath,
    ['commit-tree', stagedTree, '-p', sourceHead, '-m', 'openwaggle-workspace-handoff-index'],
    'Creating Workspace index handoff snapshot',
  )
  const snapshotCommit = await requiredGit(
    input.workingPath,
    [
      'commit-tree',
      worktreeSnapshotTree,
      '-p',
      stagedCommit,
      '-m',
      'openwaggle-workspace-handoff-worktree',
    ],
    'Creating Workspace handoff snapshot',
  )
  const snapshotRef = handoffRef(input.workspaceId)
  const anchored = await runGit(input.projectPath, [
    'update-ref',
    snapshotRef,
    snapshotCommit,
    ZERO_OBJECT_ID,
  ])
  if (anchored.code !== 0) {
    const raced = await existingSeed(input.projectPath, input.workspaceId)
    if (raced) return raced
    throw new Error(
      `Anchoring Workspace handoff snapshot failed: ${anchored.stderr.trim() || 'Git returned an error.'}`,
    )
  }
  return { sourceHead, snapshotRef }
}

export async function assertWorkspaceMatchesHandoffSeed(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly snapshotRef: string
}) {
  const [currentIndexTree, currentWorktreeTree, seedIndexTree, seedWorktreeTree] =
    await Promise.all([
      indexTree(input.workingPath),
      worktreeTree(input.workingPath),
      requiredGit(
        input.projectPath,
        ['rev-parse', `${input.snapshotRef}^1^{tree}`],
        'Reading reserved handoff index tree',
      ),
      requiredGit(
        input.projectPath,
        ['rev-parse', `${input.snapshotRef}^{tree}`],
        'Reading reserved handoff worktree tree',
      ),
    ])
  if (currentIndexTree !== seedIndexTree || currentWorktreeTree !== seedWorktreeTree) {
    throw new Error('Source Workspace changed after handoff admission.')
  }
}

export async function applyWorkspaceHandoffSeed(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly sourceHead: string
  readonly snapshotRef: string
}) {
  const targetHead = await requiredGit(
    input.workingPath,
    ['rev-parse', '--verify', 'HEAD'],
    'Resolving target Workspace HEAD',
  )
  if (targetHead !== input.sourceHead) {
    throw new Error('Target Workspace history changed before the handoff state was applied.')
  }
  const [currentIndexTree, currentWorktreeTree, headTree, seedIndexTree, seedWorktreeTree] =
    await Promise.all([
      indexTree(input.workingPath),
      worktreeTree(input.workingPath),
      requiredGit(input.workingPath, ['rev-parse', `${targetHead}^{tree}`], 'Reading target tree'),
      requiredGit(
        input.projectPath,
        ['rev-parse', `${input.snapshotRef}^1^{tree}`],
        'Reading handoff index tree',
      ),
      requiredGit(
        input.projectPath,
        ['rev-parse', `${input.snapshotRef}^{tree}`],
        'Reading handoff worktree tree',
      ),
    ])
  if (currentIndexTree === seedIndexTree && currentWorktreeTree === seedWorktreeTree) return
  if (currentIndexTree !== headTree || currentWorktreeTree !== headTree) {
    throw new Error('Target Workspace became dirty before the handoff state was applied.')
  }

  await applyTreeDelta({
    projectPath: input.projectPath,
    workingPath: input.workingPath,
    from: input.sourceHead,
    to: `${input.snapshotRef}^`,
    cached: true,
    operation: 'Workspace handoff index patch',
  })
  await applyTreeDelta({
    projectPath: input.projectPath,
    workingPath: input.workingPath,
    from: input.sourceHead,
    to: input.snapshotRef,
    cached: false,
    operation: 'Workspace handoff worktree patch',
  })
  const [appliedIndexTree, appliedWorktreeTree] = await Promise.all([
    indexTree(input.workingPath),
    worktreeTree(input.workingPath),
  ])
  if (appliedIndexTree !== seedIndexTree || appliedWorktreeTree !== seedWorktreeTree) {
    throw new Error('Target Workspace did not match the handoff snapshot after apply.')
  }
}

export async function restoreWorkspaceHandoffSeed(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly sourceHead: string
  readonly appliedSnapshotRef: string
  readonly targetSnapshotRef: string
}) {
  const targetHead = await requiredGit(
    input.workingPath,
    ['rev-parse', '--verify', 'HEAD'],
    'Resolving target Workspace HEAD for rollback',
  )
  if (targetHead !== input.sourceHead) {
    throw new Error('Target Workspace history changed after the handoff state was applied.')
  }
  const [
    currentIndexTree,
    currentWorktreeTree,
    appliedIndexTree,
    appliedWorktreeTree,
    targetIndexTree,
    targetWorktreeTree,
  ] = await Promise.all([
    indexTree(input.workingPath),
    worktreeTree(input.workingPath),
    requiredGit(
      input.projectPath,
      ['rev-parse', `${input.appliedSnapshotRef}^1^{tree}`],
      'Reading applied handoff index tree',
    ),
    requiredGit(
      input.projectPath,
      ['rev-parse', `${input.appliedSnapshotRef}^{tree}`],
      'Reading applied handoff worktree tree',
    ),
    requiredGit(
      input.projectPath,
      ['rev-parse', `${input.targetSnapshotRef}^1^{tree}`],
      'Reading target rollback index tree',
    ),
    requiredGit(
      input.projectPath,
      ['rev-parse', `${input.targetSnapshotRef}^{tree}`],
      'Reading target rollback worktree tree',
    ),
  ])
  if (currentIndexTree === targetIndexTree && currentWorktreeTree === targetWorktreeTree) return
  if (currentIndexTree !== appliedIndexTree || currentWorktreeTree !== appliedWorktreeTree) {
    throw new Error('Target Workspace changed after handoff apply; rollback preserved user edits.')
  }

  await applyTreeDelta({
    projectPath: input.projectPath,
    workingPath: input.workingPath,
    from: `${input.appliedSnapshotRef}^`,
    to: `${input.targetSnapshotRef}^`,
    cached: true,
    operation: 'Workspace handoff rollback index patch',
  })
  await applyTreeDelta({
    projectPath: input.projectPath,
    workingPath: input.workingPath,
    from: input.appliedSnapshotRef,
    to: input.targetSnapshotRef,
    cached: false,
    operation: 'Workspace handoff rollback worktree patch',
  })
  const [restoredIndexTree, restoredWorktreeTree] = await Promise.all([
    indexTree(input.workingPath),
    worktreeTree(input.workingPath),
  ])
  if (restoredIndexTree !== targetIndexTree || restoredWorktreeTree !== targetWorktreeTree) {
    throw new Error('Target Workspace did not match its snapshot after handoff rollback.')
  }
}

export async function releaseWorkspaceHandoffSeed(projectPath: string, snapshotRef: string) {
  await requiredGit(
    projectPath,
    ['update-ref', '-d', snapshotRef],
    'Releasing Workspace handoff snapshot',
  )
}
