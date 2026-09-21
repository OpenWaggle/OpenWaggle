import type { SkillDiscoveryItem } from '@shared/types/standards'
import { Context, type Effect } from 'effect'

export interface SkillDiagnosticServiceShape {
  readonly getVisualizeDiagnostic: () => Effect.Effect<SkillDiscoveryItem | null>
}

export class SkillDiagnosticService extends Context.Tag('@openwaggle/SkillDiagnosticService')<
  SkillDiagnosticService,
  SkillDiagnosticServiceShape
>() {}
