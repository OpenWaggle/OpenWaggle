import { matchBy } from '@diegogbrisa/ts-match'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationRequest,
  SessionControlReportMutationRequest,
  SessionExportCancelMutationRequest,
  SessionExportCreateMutationRequest,
} from '@shared/types/session-control'
import { executeSessionDelegationMutation } from './session-delegation-service'
import { cancelSessionExport } from './session-export-cancellation'
import { createSessionExport } from './session-export-operation-service'
import { organizeSession } from './session-organization-service'
import { submitSessionReport } from './session-report-service'

type ResourceCommand = Extract<
  SessionControlMutationRequest['command'],
  {
    readonly operation:
      | 'report'
      | 'export-create'
      | 'export-cancel'
      | 'rename'
      | 'archive'
      | 'unarchive'
      | 'handoff'
      | 'delegation-submit'
      | 'delegation-claim'
      | 'delegation-conflict-acknowledge'
      | 'delegation-dependency'
      | 'delegation-propose-amendment'
      | 'delegation-amend'
      | 'delegation-state'
      | 'delegation-request-revision'
      | 'delegation-accept'
      | 'delegation-reopen'
      | 'delegation-cancel'
      | 'delegation-verify'
  }
>

function executeDelegationCommand(
  callerId: string,
  request: SessionControlMutationRequest,
  command: SessionControlDelegationMutationRequest['command'],
) {
  return executeSessionDelegationMutation({
    callerId,
    request: { ...request, command } satisfies SessionControlDelegationMutationRequest,
  })
}

export function executeResourceSessionControlCommand(
  input: {
    readonly callerId: string
    readonly request: SessionControlMutationRequest
    readonly authority?: LocalSessionProfileAuthority
  },
  command: ResourceCommand,
) {
  const { callerId, request, authority } = input
  return matchBy(command, 'operation')
    .with('report', (command) =>
      submitSessionReport({
        callerId,
        ...(authority ? { authority } : {}),
        request: { ...request, command } satisfies SessionControlReportMutationRequest,
      }),
    )
    .with('export-create', (command) =>
      createSessionExport({
        callerId,
        ...(authority ? { authority } : {}),
        request: { ...request, command } satisfies SessionExportCreateMutationRequest,
      }),
    )
    .with('export-cancel', (command) =>
      cancelSessionExport({
        request: { ...request, command } satisfies SessionExportCancelMutationRequest,
      }),
    )
    .with('rename', 'archive', 'unarchive', 'handoff', (command) =>
      organizeSession({ callerId, request: { ...request, command } }),
    )
    .with(
      'delegation-submit',
      'delegation-claim',
      'delegation-conflict-acknowledge',
      'delegation-dependency',
      'delegation-propose-amendment',
      'delegation-amend',
      'delegation-state',
      'delegation-request-revision',
      'delegation-accept',
      'delegation-reopen',
      'delegation-cancel',
      'delegation-verify',
      (command) => executeDelegationCommand(callerId, request, command),
    )
    .exhaustive()
}
