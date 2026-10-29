import * as Layer from 'effect/Layer'
import { AutomaticWorktreeRemovalLogStoreLive } from './adapters/filesystem-automatic-worktree-removal-log'
import { WorktreeSpaceServiceLive } from './adapters/filesystem-worktree-space-service'
import { GitWorktreeServiceLive } from './adapters/git-worktree-service'
import { registerPiBundledOAuthFlows } from './adapters/pi/pi-bundled-oauth'
import { PiSkillDiagnosticServiceLive } from './adapters/pi/pi-skill-diagnostic-service'

registerPiBundledOAuthFlows()

export const OperationAdapterLive = Layer.mergeAll(
  GitWorktreeServiceLive,
  PiSkillDiagnosticServiceLive,
  WorktreeSpaceServiceLive,
  AutomaticWorktreeRemovalLogStoreLive,
)
