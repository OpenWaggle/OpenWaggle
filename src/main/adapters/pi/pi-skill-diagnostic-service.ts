import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SkillDiagnosticService } from '../../ports/skill-diagnostic-service'
import { getPiVisualizeSkillDiagnostic } from './pi-visualize-skill'

export const PiSkillDiagnosticServiceLive = Layer.succeed(
  SkillDiagnosticService,
  SkillDiagnosticService.of({
    getVisualizeDiagnostic: () => Effect.promise(() => getPiVisualizeSkillDiagnostic()),
  }),
)
