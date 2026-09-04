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
import { getLocalVcsStatus } from './vcs-status-service'

function shouldConfirmDefaultBranchAction(
  status: LocalVcsStatus,
  options: GitRunStackedActionOptions,
): options is GitRunStackedActionOptions & { readonly action: DefaultBranchConfirmableAction } {
  const requestedFeatureRef = options.featureBranchName?.trim()
  const plannedFeatureRef = requestedFeatureRef
    ? sanitizeFeatureBranchName(requestedFeatureRef)
    : null
  const definitelyCreatesSeparateRef =
    options.createFeatureBranch === true &&
    plannedFeatureRef !== null &&
    plannedFeatureRef !== status.refName &&
    plannedFeatureRef !== status.pushTargetRef &&
    plannedFeatureRef !== status.defaultRef
  if (definitelyCreatesSeparateRef) return false
  const plannedFeatureRefCollides =
    options.createFeatureBranch === true &&
    plannedFeatureRef !== null &&
    (plannedFeatureRef === status.refName ||
      plannedFeatureRef === status.pushTargetRef ||
      plannedFeatureRef === status.defaultRef)
  return requiresDefaultBranchConfirmation(
    options.action,
    targetsDefaultRef(status) || plannedFeatureRefCollides,
  )
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

function gitTargetIdentity(status: LocalVcsStatus) {
  return JSON.stringify([status.refName, status.pushTargetRef, status.defaultRef])
}

/** Main-process default-branch gate from ADR 0012. */
export function confirmDefaultBranchAction(
  event: IpcMainInvokeEvent,
  projectPath: string,
  options: GitRunStackedActionOptions,
) {
  return Effect.gen(function* () {
    const local = yield* Effect.promise(() => getLocalVcsStatus(projectPath))
    if (!local.ok) {
      const confirmed = yield* askDefaultBranchConfirmation(event, {
        title: 'Continue without checking the current ref?',
        description: `The current ref could not be read (${local.message}), so it is not known whether this action targets the default ref. Continue anyway?`,
        continueLabel: 'Continue',
      })
      return { confirmed, targetIdentity: null }
    }
    if (!shouldConfirmDefaultBranchAction(local.status, options)) {
      return { confirmed: true, targetIdentity: gitTargetIdentity(local.status) }
    }
    const copy = resolveDefaultBranchActionDialogCopy({
      action: options.action,
      branchName: defaultBranchActionLabel(local.status),
      includesCommit: options.action.startsWith('commit'),
      provider: local.status.sourceControlProvider?.id ?? null,
    })
    const confirmed = yield* askDefaultBranchConfirmation(event, copy)
    return { confirmed, targetIdentity: gitTargetIdentity(local.status) }
  })
}

export function revalidateGitTarget(projectPath: string, expectedIdentity: string | null) {
  if (expectedIdentity === null) return Effect.succeed(true)
  return Effect.promise(() => getLocalVcsStatus(projectPath)).pipe(
    Effect.map((current) => current.ok && gitTargetIdentity(current.status) === expectedIdentity),
  )
}
