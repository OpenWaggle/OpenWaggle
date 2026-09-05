import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { userShell } from '../../env'

/**
 * Shell resolution with a fallback chain (ADR 0030): the user's shell when it
 * exists, then platform defaults. Spawn callers retry down the chain when a
 * shell binary disappears between check and spawn.
 */

export function posixShellCandidates(): readonly string[] {
  const candidates = [userShell, '/bin/zsh', '/bin/bash', '/bin/sh']
  const seen = new Set<string>()
  const unique: string[] = []
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0 && !seen.has(candidate)) {
      seen.add(candidate)
      unique.push(candidate)
    }
  }
  return unique
}

export function windowsShellCandidates(): readonly string[] {
  return ['pwsh.exe', 'powershell.exe', 'cmd.exe']
}

export function shellCandidates(): readonly string[] {
  return os.platform() === 'win32' ? windowsShellCandidates() : posixShellCandidates()
}

/** Filter candidates to shells that currently exist on disk. */
export function existingShells(): readonly string[] {
  return shellCandidates().filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

/** Absolute, existing-directory validation for a terminal Working path. */
export function validateTerminalCwd(cwd: string): string | null {
  const candidate = cwd.trim()
  if (candidate.length === 0 || !path.isAbsolute(candidate)) return null
  try {
    if (!fs.statSync(candidate).isDirectory()) return null
  } catch {
    return null
  }
  return candidate
}
