import { bootShell } from './desktop-shell/boot-shell'

/**
 * Dev builds isolate their userData so a stale local/worktree build can never read or overwrite
 * the installed release's sessions, settings, or credentials — the incident ADR 0032 exists to
 * prevent. The shell derives userData from the build's name, so this must run before the first
 * `userData()` consumer; every entry point imports it first. Released builds keep the
 * canonical name (`openwaggle`), so the existing install base is not orphaned.
 */
bootShell.applyBuildIdentity()
