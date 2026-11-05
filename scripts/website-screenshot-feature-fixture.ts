import fs from 'node:fs/promises'
import path from 'node:path'
import { SupportedModelId } from '@shared/types/brand'
import { fixtureGit } from './website-screenshot-fixture-git'
import type { ScreenshotProject } from './website-screenshot-project'

export const CODEMODE_THREAD_TITLE = 'Find the TODOs left in the API client'
// No title may contain "Settings": the existing captures find the sidebar's Settings button by substring.
export const COMPACTION_THREAD_TITLE = 'Move app preferences to SQLite'
export const MISSING_WORKTREE_THREAD_TITLE = 'Draft the changelog entry'
/** The Session the Waggle capture starts from the message box, so its title comes from the fake model. */
export const WAGGLE_THREAD_TITLE = 'Review API client error handling'
export const WAGGLE_PRESET_NAME = 'Code Review'
export const ANTHROPIC_OPUS = SupportedModelId('anthropic/claude-opus-4-6')
const MINUTE_MS = 60_000

/** A time `minutes` before `now`, for seeded message timestamps. */
export function minutesAgo(now: number, minutes: number) {
  return now - minutes * MINUTE_MS
}

const PROJECT_FILES: Readonly<Record<string, string>> = {
  // Project Waggle presets live in `.pi/`; ignored, so saving one leaves the Changes panel alone.
  '.gitignore': '.pi/\n',
  'AGENTS.md': [
    '# Project instructions',
    '',
    '- Use pnpm for every package command.',
    '- Run `pnpm test` before you report a change as done.',
    '',
  ].join('\n'),
  '.agents/skills/review-change/SKILL.md': [
    '---',
    'name: review-change',
    'description: Review a Git diff for bugs, regressions, and missing tests.',
    '---',
    '',
    '# Review a change',
    '',
    'Read the diff and the affected callers before drawing conclusions.',
    'Report concrete defects with file and line references.',
    'Do not edit files unless asked. State which checks you ran and which you did not.',
    '',
  ].join('\n'),
  '.openwaggle/skills/write-migration/SKILL.md': [
    '---',
    'name: write-migration',
    'description: Write a forward-only SQLite migration with a test that runs it on a copy of real data.',
    '---',
    '',
    '# Write a migration',
    '',
    'Add the next numbered file under `src/db/migrations/`. Never edit a migration that has shipped.',
    'Write a test that applies every migration in order to the fixture database.',
    '',
  ].join('\n'),
  '.agents/agents/release-verifier.md': [
    '---',
    'name: release-verifier',
    'description: Checks a release candidate against the release checklist',
    'tools: read, grep, bash',
    '---',
    '',
    'Work through the release checklist in `docs/release.md` in order.',
    'Report each item as passed, failed or not checked, with the command you ran.',
    '',
  ].join('\n'),
  '.openwaggle/agents/code-reviewer.md': [
    '---',
    'name: code-reviewer',
    'description: Reviews code for concrete defects',
    'tools: read, grep',
    '---',
    '',
    'Review the change and report actionable findings with file references.',
    '',
  ].join('\n'),
}

/**
 * Project instructions, two skills and two agent definitions for Settings > Skills and Agents.
 * Committed, so the Changes panel still shows only the fixture's README edit.
 */
export async function addFeatureProjectFiles(project: ScreenshotProject, homeDir: string) {
  for (const [relativePath, content] of Object.entries(PROJECT_FILES)) {
    const target = path.join(project.projectPath, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
  await fixtureGit(project.projectPath, ['add', ...Object.keys(PROJECT_FILES)], homeDir)
  await fixtureGit(project.projectPath, ['commit', '-m', 'chore: add agent instructions'], homeDir)
}
