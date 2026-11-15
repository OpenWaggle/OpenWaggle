import { join } from 'node:path'
import {
  configureDefaultSessionEmbeddingModelFiles,
  SESSION_EMBEDDING_MODEL,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from './adapters/multilingual-e5-session-embedding-model'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { appPaths } from './desktop-shell/app-paths'

/** Under userData: every Build channel and every update shares one download per model revision. */
export const SESSION_EMBEDDING_MODEL_DOWNLOAD_DIRECTORY = ['models', 'session-embedding'] as const

/**
 * The Session embedding model is fetched on first use, not shipped (session-embedding-model-files.ts).
 * A copy beside the app is still used: in a package's resources, or the one `bun run
 * prepare:semantic-model` writes to `build/` for a development checkout.
 */
export function configureSessionEmbeddingModel() {
  const bundled = appLifecycle.isPackaged()
    ? join(process.resourcesPath, SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY)
    : join(__dirname, '..', '..', 'build', SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY)
  configureDefaultSessionEmbeddingModelFiles({
    downloadDirectory: () =>
      join(
        appPaths.userData(),
        ...SESSION_EMBEDDING_MODEL_DOWNLOAD_DIRECTORY,
        SESSION_EMBEDDING_MODEL.revision,
      ),
    bundledDirectory: bundled,
  })
}
