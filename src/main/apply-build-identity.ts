import { BUILD_CHANNEL, PRODUCT_NAME } from '@shared/build-identity-runtime'
import { app } from 'electron'

/**
 * Dev builds isolate their userData so a stale local/worktree build can never
 * read or overwrite the installed release's sessions, settings, or credentials
 * — the incident ADR 0032 exists to prevent. Electron derives userData from
 * `app.getName()`, so this must run before the first `app.getPath('userData')`
 * consumer; it is imported first in index.ts. Released builds keep the canonical
 * name (`openwaggle`), so the existing install base is not orphaned.
 */
if (BUILD_CHANNEL === 'dev') {
  app.setName(PRODUCT_NAME)
}
