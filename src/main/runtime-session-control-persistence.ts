import * as Layer from 'effect/Layer'
import { GitSessionWorkspaceHandoffServiceLive } from './adapters/git-session-workspace-handoff-service'
import { SqliteExplicitWaggleOperationJournalLive } from './adapters/sqlite-explicit-waggle-operation-journal'
import { SqliteFollowUpEditHoldRepositoryLive } from './adapters/sqlite-follow-up-edit-hold-repository'
import { SqliteLocalSessionProfileRepositoryLive } from './adapters/sqlite-local-session-profile-repository'
import { SqliteSessionAuthorizationTargetRepositoryLive } from './adapters/sqlite-session-authorization-target-repository'
import { SqliteSessionControlOperationJournalLive } from './adapters/sqlite-session-control-operation-journal'
import { SqliteSessionControlRepositoryLive } from './adapters/sqlite-session-control-repository'
import { SqliteSessionControlRunLifecycleRepositoryLive } from './adapters/sqlite-session-control-run-lifecycle-repository'
import { SqliteSessionDelegationRepositoryLive } from './adapters/sqlite-session-delegation-repository'
import { SqliteSessionDescendantRunRepositoryLive } from './adapters/sqlite-session-descendant-run-repository'
import { SqliteSessionExportLiveAuthorityLive } from './adapters/sqlite-session-export-live-authority'
import { SqliteSessionExportOperationRepositoryLive } from './adapters/sqlite-session-export-operation-repository'
import { SqliteSessionHostRecoveryRepositoryLive } from './adapters/sqlite-session-host-recovery-repository'
import { SqliteSessionLifecycleRepositoryLive } from './adapters/sqlite-session-lifecycle-repository'
import { SqliteSessionOrchestrationUpdateRepositoryLive } from './adapters/sqlite-session-orchestration-update-repository'
import { SqliteSessionOrganizationRepositoryLive } from './adapters/sqlite-session-organization-repository'
import { SqliteSessionQueryRepositoryLive } from './adapters/sqlite-session-query-repository'
import { SqliteSessionReportRepositoryLive } from './adapters/sqlite-session-report-repository'
import { SqliteSessionSettingsRepositoryLive } from './adapters/sqlite-session-settings-repository'
import { SqliteSessionWorkspaceResourceRepositoryLive } from './adapters/sqlite-session-workspace-resource-repository'
import { AppDatabaseLive } from './services/database-service'

/** Session Control's SQLite repositories, sharing the app database. */
export const SessionControlPersistenceLive = Layer.mergeAll(
  GitSessionWorkspaceHandoffServiceLive,
  SqliteLocalSessionProfileRepositoryLive,
  SqliteSessionAuthorizationTargetRepositoryLive,
  SqliteSessionControlOperationJournalLive,
  SqliteExplicitWaggleOperationJournalLive,
  SqliteSessionControlRepositoryLive,
  SqliteSessionControlRunLifecycleRepositoryLive,
  SqliteFollowUpEditHoldRepositoryLive,
  SqliteSessionHostRecoveryRepositoryLive,
  SqliteSessionLifecycleRepositoryLive,
  SqliteSessionQueryRepositoryLive,
  SqliteSessionReportRepositoryLive,
  SqliteSessionOrchestrationUpdateRepositoryLive,
  SqliteSessionOrganizationRepositoryLive,
  SqliteSessionDelegationRepositoryLive,
  SqliteSessionDescendantRunRepositoryLive,
  SqliteSessionExportOperationRepositoryLive,
  SqliteSessionExportLiveAuthorityLive,
  SqliteSessionWorkspaceResourceRepositoryLive,
  SqliteSessionSettingsRepositoryLive,
).pipe(Layer.provide(AppDatabaseLive))
