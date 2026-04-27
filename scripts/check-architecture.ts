/**
 * Architecture compliance checker.
 *
 * Validates that the hexagonal architecture boundaries are respected.
 * All rules are enforced — zero violations tolerated.
 *
 * Run via: pnpm check:architecture
 */
import { execSync } from 'node:child_process'
import process from 'node:process'

interface ArchitectureRule {
  readonly name: string
  readonly command: string
  readonly allowEmpty: boolean
}

const RULES: readonly ArchitectureRule[] = [
  // ── Vendor isolation ───────────────────────────────────────
  {
    name: 'No Pi SDK imports outside pi adapter',
    command:
      "grep -Rnl \"@mariozechner/pi-coding-agent\" src --include='*.ts' | grep -v '^src/main/adapters/pi/'",
    allowEmpty: true,
  },

  // ── Handler isolation (no direct store access) ─────────────
  {
    name: 'No direct store/ imports in IPC handlers',
    command:
      "grep -rn \"from '../../store/\\|from '../store/\" src/main/ipc/ --include='*.ts' | grep -v __tests__",
    allowEmpty: true,
  },

  // ── Provider singleton isolation ───────────────────────────
  {
    name: 'No providerRegistry outside adapters/providers/services/store',
    command:
      "grep -rn providerRegistry src/main/ --include='*.ts' | grep -v __tests__ | grep -v 'src/main/adapters/' | grep -v 'src/main/providers/' | grep -v 'src/main/services/' | grep -v 'src/main/store/'",
    allowEmpty: true,
  },

  // ── Domain purity ──────────────────────────────────────────
  {
    name: 'No infrastructure imports in domain/',
    command:
      "grep -rn \"node:fs\\|node:child_process\\|@effect/sql\\|from 'electron'\" src/main/domain/ src/shared/domain/ --include='*.ts'",
    allowEmpty: true,
  },

  // ── Application service isolation ──────────────────────────
  {
    name: 'No direct store/ imports in application/',
    command:
      "grep -rl \"from '.*store/\" src/main/application/ --include='*.ts' | grep -v __tests__",
    allowEmpty: true,
  },
  {
    name: 'No IPC imports in application/',
    command:
      "grep -rl \"from '.*ipc/\" src/main/application/ --include='*.ts' | grep -v __tests__",
    allowEmpty: true,
  },
]

let violations = 0

for (const rule of RULES) {
  try {
    const result = execSync(rule.command, { encoding: 'utf-8' }).trim()
    if (result && rule.allowEmpty) {
      console.error(`VIOLATION: ${rule.name}`)
      console.error(result)
      violations++
    }
  } catch {
    // grep returns exit 1 when no matches found — that's success for allowEmpty rules
  }
}

if (violations > 0) {
  console.error(`\n${violations} architecture violation(s) found`)
  process.exit(1)
}

console.log('check-architecture: all rules pass (0 violations)')
