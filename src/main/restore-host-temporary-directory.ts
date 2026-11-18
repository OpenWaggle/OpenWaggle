import { restoreHostTemporaryDirectory } from './env'

/**
 * An OpenWaggle process started from an agent shell inherits that Session's scratch directory as
 * `TMPDIR`; move it back to the Host's temp directory before any module caches a temp path, so the
 * process's temp files do not vanish when the Session is archived (ADR 0042). Imported for its
 * side effect near the top of index.ts.
 */
restoreHostTemporaryDirectory()
