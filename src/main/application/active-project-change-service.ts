import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Runtime from 'effect/Runtime'
import {
  ActiveProjectChangeService,
  type ActiveProjectChangeServiceShape,
} from '../ports/active-project-change-service'
import {
  reconcileTrustedMainExtensionsForProject,
  type TrustedMainActivationBaseServices,
} from './extension-trusted-main-activation-service'

export const ActiveProjectChangeServiceLive = Layer.effect(
  ActiveProjectChangeService,
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<TrustedMainActivationBaseServices>()
    const runTrustedMainReconciliation = Runtime.runPromise(runtime)
    const reconcileTrustedMainExtensions: ActiveProjectChangeServiceShape['reconcileTrustedMainExtensions'] =
      (projectPath) =>
        Effect.promise(() =>
          runTrustedMainReconciliation(
            reconcileTrustedMainExtensionsForProject(projectPath).pipe(
              Effect.provideService(
                ActiveProjectChangeService,
                ActiveProjectChangeService.of({ reconcileTrustedMainExtensions }),
              ),
              Effect.asVoid,
            ),
          ),
        )

    return ActiveProjectChangeService.of({ reconcileTrustedMainExtensions })
  }),
)
