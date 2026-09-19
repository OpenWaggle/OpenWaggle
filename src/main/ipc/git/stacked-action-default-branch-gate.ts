import type { GitRunStackedActionOptions } from '@shared/types/git'
import type { LocalVcsStatus } from '@shared/types/vcs'
import {
  type DefaultBranchActionDialogCopy,
  type DefaultBranchConfirmableAction,
  defaultBranchActionLabel,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  sanitizeFeatureBranchName,
  targetsDefaultRef,
} from '@shared/utils/git-stacked-action'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent, MessageBoxOptions } from 'electron'
import { browserWindowFromWebContents, showMessageBox } from '../../desktop-ui'
import { resolveLocalDefaultRef } from './default-ref'
import { resolvePrimaryRemoteResult } from './primary-remote'
import type { GitPinnedPushTarget } from './push-service'
import { type GitPushRefReadResult, readPushRef } from './upstream-ref'
import {
  resolveSafeLocalPushDestination,
  type SafeLocalPushDestination,
} from './vcs-local-push-destination'
import { getLocalVcsStatus } from './vcs-status-service'

function shouldConfirmDefaultBranchAction(
  status: LocalVcsStatus,
  options: GitRunStackedActionOptions,
): options is GitRunStackedActionOptions & { readonly action: DefaultBranchConfirmableAction } {
  return requiresDefaultBranchConfirmation(options.action, targetsDefaultRef(status))
}

function readsPushDestination(action: GitRunStackedActionOptions['action']) {
  return (
    action === 'push' ||
    action === 'create_pr' ||
    action === 'commit_push' ||
    action === 'commit_push_pr'
  )
}

export function resolvePlannedFeatureRef(options: GitRunStackedActionOptions): string | null {
  const requested = options.featureBranchName?.trim()
  if (!options.createFeatureBranch || !requested) return null
  return options.exactFeatureBranchName ? requested : sanitizeFeatureBranchName(requested)
}

function askDefaultBranchConfirmation(
  event: IpcMainInvokeEvent,
  copy: DefaultBranchActionDialogCopy,
) {
  return Effect.gen(function* () {
    const ownerWindow = browserWindowFromWebContents(event.sender)
    const dialogOptions = {
      type: 'warning',
      buttons: ['Cancel', copy.continueLabel],
      defaultId: 0,
      cancelId: 0,
      message: copy.title,
      detail: copy.description,
    } satisfies MessageBoxOptions
    const confirmation = yield* Effect.promise(() => showMessageBox(ownerWindow, dialogOptions))
    return confirmation.response === 1
  })
}

async function gitTargetIdentity(
  projectPath: string,
  status: LocalVcsStatus,
  readsPushDestination: boolean,
  branchName = status.refName,
): Promise<
  | {
      readonly ok: true
      readonly identity: string
      readonly pushTargetRef: string | null
      readonly pushTargetIsDefaultRef: boolean
      readonly pinnedPushTarget: GitPinnedPushTarget | null
    }
  | { readonly ok: false; readonly message: string; readonly recoverable?: boolean }
> {
  if (!readsPushDestination) {
    return {
      ok: true,
      identity: JSON.stringify(['branch-only', branchName]),
      pushTargetRef: branchName,
      pushTargetIsDefaultRef: false,
      pinnedPushTarget: null,
    }
  }
  if (branchName === null) {
    return {
      ok: false,
      message: 'Create or check out a branch before publishing a detached HEAD.',
      recoverable: false,
    }
  }
  const primaryRemoteResult = await resolvePrimaryRemoteResult(projectPath)
  if (!primaryRemoteResult.ok) {
    return { ok: false, message: primaryRemoteResult.message }
  }
  const primaryRemote = primaryRemoteResult.remote
  const primaryRemoteName = primaryRemote?.name ?? 'origin'
  const pushRefResult = await resolveEffectivePushRef(projectPath, branchName, primaryRemoteName)
  if (!pushRefResult.ok) return pushRefResult
  if (primaryRemote === null && pushRefResult.usedFallbackRemote) {
    return {
      ok: false,
      message: 'Add a Git remote before publishing this branch.',
      recoverable: false,
    }
  }
  const pushRefName = pushRefResult.upstream
    ? `${pushRefResult.upstream.remote}/${pushRefResult.upstream.branch}`
    : null
  const remote = pushRefResult.upstream?.remote ?? null
  const primaryDefaultRef = await resolvePrimaryDefaultRef(
    projectPath,
    status,
    primaryRemoteName,
    remote,
  )
  const pushDestination = remote
    ? await resolveSafeLocalPushDestination(projectPath, remote, primaryRemote, primaryDefaultRef)
    : ({ ok: true, defaultRef: null, fetchUrl: '', pushUrls: [] } as const)
  if (!pushDestination.ok) return pushDestination
  return buildPushTargetIdentity(branchName, pushRefResult, pushRefName, remote, pushDestination)
}

async function resolveEffectivePushRef(
  projectPath: string,
  branchName: string | null,
  primaryRemoteName: string,
): Promise<GitPushRefReadResult> {
  const configured = await readPushRef(projectPath, branchName)
  return configured.ok && !configured.upstream
    ? readPushRef(projectPath, branchName, primaryRemoteName)
    : configured
}

async function resolvePrimaryDefaultRef(
  projectPath: string,
  status: LocalVcsStatus,
  primaryRemoteName: string,
  pushRemoteName: string | null,
) {
  return primaryRemoteName === pushRemoteName
    ? (status.defaultRef ?? null)
    : resolveLocalDefaultRef(projectPath, primaryRemoteName)
}

function buildPushTargetIdentity(
  branchName: string | null,
  pushRefResult: Extract<GitPushRefReadResult, { readonly ok: true }>,
  pushRefName: string | null,
  remote: string | null,
  pushDestination: Extract<SafeLocalPushDestination, { readonly ok: true }>,
) {
  const pushTargetRef = pushRefResult.upstream?.branch ?? branchName
  const pushTargetIsDefaultRef =
    pushTargetRef !== null &&
    (pushDestination.defaultRef === null || pushTargetRef === pushDestination.defaultRef)
  const pinnedPushTarget: GitPinnedPushTarget | null =
    branchName && remote && pushRefResult.upstream
      ? {
          sourceBranch: branchName,
          remote,
          branch: pushRefResult.upstream.branch,
          pushUrls: pushDestination.pushUrls,
        }
      : null
  return {
    ok: true as const,
    identity: JSON.stringify([
      branchName,
      pushTargetRef,
      pushTargetIsDefaultRef,
      pushDestination.defaultRef,
      pushRefName,
      remote,
      pushDestination.fetchUrl,
      pushDestination.pushUrls,
    ]),
    pushTargetRef,
    pushTargetIsDefaultRef,
    pinnedPushTarget,
  }
}

/** Main-process default-branch gate from ADR 0012. */
export function confirmDefaultBranchAction(
  event: IpcMainInvokeEvent,
  projectPath: string,
  options: GitRunStackedActionOptions,
) {
  return Effect.gen(function* () {
    const readsPush = readsPushDestination(options.action)
    const local = yield* Effect.promise(() =>
      getLocalVcsStatus(projectPath, { resolvePushDestination: false }),
    )
    if (!local.ok) {
      const confirmed = yield* askDefaultBranchConfirmation(event, {
        title: 'Continue without checking the current ref?',
        description: `The current ref could not be read (${local.message}), so it is not known whether this action targets the default ref. Continue anyway?`,
        continueLabel: 'Continue',
      })
      return {
        confirmed,
        targetIdentity: null,
        pinnedPushTarget: null,
        blockingFailure: null,
      }
    }
    // Capture before any confirmation UI. A branch, upstream, remote, or push-URL change while
    // the user is reviewing the dialog must invalidate the decision just like a later change.
    const plannedFeatureRef = resolvePlannedFeatureRef(options)
    const actionRef = plannedFeatureRef ?? local.status.refName
    const targetIdentityResult = yield* Effect.promise(() =>
      gitTargetIdentity(projectPath, local.status, readsPush, actionRef),
    )
    if (!targetIdentityResult.ok) {
      if (targetIdentityResult.recoverable === false) {
        return {
          confirmed: false,
          targetIdentity: null,
          pinnedPushTarget: null,
          blockingFailure: targetIdentityResult.message,
        }
      }
      const confirmed = yield* askDefaultBranchConfirmation(event, {
        title: 'Continue without verifying the Git destination?',
        description: `${targetIdentityResult.message} It is not known whether this action targets the default ref. Continue anyway?`,
        continueLabel: 'Continue',
      })
      return {
        confirmed,
        targetIdentity: null,
        pinnedPushTarget: null,
        blockingFailure: null,
      }
    }
    const targetIdentity = targetIdentityResult.identity
    const effectiveStatus: LocalVcsStatus = {
      ...local.status,
      ...(plannedFeatureRef ? { refName: plannedFeatureRef, isDefaultRef: false } : {}),
      ...(readsPush
        ? {
            pushTargetRef: targetIdentityResult.pushTargetRef,
            pushTargetIsDefaultRef: targetIdentityResult.pushTargetIsDefaultRef,
          }
        : {}),
    }
    if (!shouldConfirmDefaultBranchAction(effectiveStatus, options)) {
      return {
        confirmed: true,
        targetIdentity,
        pinnedPushTarget: targetIdentityResult.pinnedPushTarget,
        blockingFailure: null,
      }
    }
    const copy = resolveDefaultBranchActionDialogCopy({
      action: options.action,
      branchName: defaultBranchActionLabel(effectiveStatus),
      includesCommit: options.action.startsWith('commit'),
      provider: local.status.sourceControlProvider?.id ?? null,
    })
    const confirmed = yield* askDefaultBranchConfirmation(event, copy)
    return {
      confirmed,
      targetIdentity,
      pinnedPushTarget: targetIdentityResult.pinnedPushTarget,
      blockingFailure: null,
    }
  })
}

export function revalidateGitTarget(
  projectPath: string,
  expectedIdentity: string | null,
  action: GitRunStackedActionOptions['action'],
  plannedFeatureRef: string | null = null,
) {
  if (expectedIdentity === null) {
    return Effect.succeed({ matches: true as const, pinnedPushTarget: null })
  }
  const readsPush = readsPushDestination(action)
  return Effect.promise(() =>
    getLocalVcsStatus(projectPath, { resolvePushDestination: false }),
  ).pipe(
    Effect.flatMap((current) =>
      current.ok
        ? Effect.promise(() =>
            gitTargetIdentity(
              projectPath,
              current.status,
              readsPush,
              plannedFeatureRef ?? current.status.refName,
            ),
          ).pipe(
            Effect.map((result) =>
              result.ok && result.identity === expectedIdentity
                ? { matches: true as const, pinnedPushTarget: result.pinnedPushTarget }
                : { matches: false as const, pinnedPushTarget: null },
            ),
          )
        : Effect.succeed({ matches: false as const, pinnedPushTarget: null }),
    ),
  )
}
