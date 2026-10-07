import * as Layer from 'effect/Layer'
import { GitWorktreeServiceLive } from './adapters/git-worktree-service'
import { registerPiBundledOAuthFlows } from './adapters/pi/pi-bundled-oauth'
import { PiSkillDiagnosticServiceLive } from './adapters/pi/pi-skill-diagnostic-service'

registerPiBundledOAuthFlows()

export const OperationAdapterLive = Layer.mergeAll(
  GitWorktreeServiceLive,
  PiSkillDiagnosticServiceLive,
)
