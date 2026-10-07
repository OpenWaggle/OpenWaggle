import {
  type CurrentChangeRequest,
  findCurrentChangeRequest,
} from '../../services/source-control/fork-change-requests'
import { projectSettingsKey } from '../../services/source-control/project-root'
import {
  configureSourceControl,
  resolveChangeRequestOpenDestination,
} from '../../services/source-control/source-control-configuration'
import { listSourceControlHosts } from '../../services/source-control/source-control-hosts-list'
import { sourceControlSettingsAccess } from '../../services/source-control/source-control-runtime'
import type { SourceControlSettingsAccess } from '../../services/source-control/source-control-settings-access'
import {
  attentionForFailure,
  openWorkingTreeSourceControl,
  type WorkingTreeSourceControl,
} from '../../services/source-control/working-tree-source-control'
import { runGit } from '../git/run-git'

/** The source-control services the agent tool reads and changes, injectable for tests. */
export interface SourceControlToolBackend {
  readonly access: () => SourceControlSettingsAccess
  readonly openWorkingTree: typeof openWorkingTreeSourceControl
  readonly resolveProjectRoot: (workingPath: string) => Promise<string | null>
  readonly currentBranch: (workingPath: string) => Promise<string | null>
  readonly findCurrentChangeRequest: (
    sourceControl: WorkingTreeSourceControl,
    workingPath: string,
    branch: string,
    access: SourceControlSettingsAccess,
  ) => Promise<CurrentChangeRequest>
  readonly attentionForFailure: typeof attentionForFailure
  readonly listHosts: typeof listSourceControlHosts
  readonly resolveOpenDestination: typeof resolveChangeRequestOpenDestination
  readonly configure: typeof configureSourceControl
}

async function gitOutput(workingPath: string, args: string[]) {
  const result = await runGit(workingPath, args)
  const output = result.code === 0 ? result.stdout.trim() : ''
  return output || null
}

export const LIVE_SOURCE_CONTROL_TOOL_BACKEND: SourceControlToolBackend = {
  access: sourceControlSettingsAccess,
  openWorkingTree: openWorkingTreeSourceControl,
  // The same key the Session Summary and Settings use, so the agent's changes land there too.
  resolveProjectRoot: projectSettingsKey,
  currentBranch: (workingPath) => gitOutput(workingPath, ['branch', '--show-current']),
  findCurrentChangeRequest: (sourceControl, workingPath, branch, access) =>
    findCurrentChangeRequest(sourceControl, workingPath, branch, access),
  attentionForFailure,
  listHosts: (access) => listSourceControlHosts(access),
  resolveOpenDestination: resolveChangeRequestOpenDestination,
  configure: (request, access) => configureSourceControl(request, access),
}
