import * as Layer from 'effect/Layer'
import { PiSessionTitleGeneratorLive } from './adapters/pi/pi-session-title-generator'
import { SqliteSessionTitleRepositoryLive } from './adapters/sqlite-session-title-repository'
import { AppDatabaseLive } from './services/database-service'

/** The Title model and title persistence used by the Session Host's background title work. */
export const SessionTitleServicesLive = Layer.mergeAll(
  SqliteSessionTitleRepositoryLive.pipe(Layer.provide(AppDatabaseLive)),
  PiSessionTitleGeneratorLive,
)
