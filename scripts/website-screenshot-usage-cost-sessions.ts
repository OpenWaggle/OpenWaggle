/**
 * The made-up Pi sessions behind the Usage & Cost page (`website-screenshot-usage-cost-fixture.ts`
 * writes them): two projects, five models, OpenWaggle and `pi` CLI origins, over 28 days.
 */

export interface Rates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface FixtureModel {
  readonly provider: string
  readonly modelId: string
  /** USD per million tokens, for the costs Pi recorded. */
  readonly rates: Rates
}

const OPUS: FixtureModel = {
  provider: 'anthropic',
  modelId: 'claude-opus-4-6',
  rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
}
const SONNET: FixtureModel = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
}
const GPT: FixtureModel = {
  provider: 'openai',
  modelId: 'gpt-5.4',
  rates: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
}
const GEMINI: FixtureModel = {
  provider: 'google',
  modelId: 'gemini-2.5-pro',
  rates: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
}
const HAIKU: FixtureModel = {
  provider: 'anthropic',
  modelId: 'claude-haiku-4-5',
  rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

export type Origin = 'openwaggle' | 'pi-cli'

export interface FixtureSession {
  readonly project: 'jotter' | 'OpenWaggle'
  readonly origin: Origin
  readonly model: FixtureModel
  readonly prompt: string
  /** Whole days before the capture. */
  readonly daysAgo: number
  readonly turns: number
  /** Ends with a compaction, which the page counts under Tools/summaries. */
  readonly compacted?: boolean
}

export const USAGE_COST_SESSIONS: readonly FixtureSession[] = [
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Stop retrying 4xx uploads',
    daysAgo: 0,
    turns: 7,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: GPT,
    prompt: 'Add a dark theme to the editor toolbar',
    daysAgo: 1,
    turns: 5,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Prepare the 1.0 release',
    daysAgo: 1,
    turns: 9,
    compacted: true,
  },
  {
    project: 'jotter',
    origin: 'pi-cli',
    model: GPT,
    prompt: 'Why does the sync test time out on CI?',
    daysAgo: 2,
    turns: 4,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: SONNET,
    prompt: 'Review the queue steering changes',
    daysAgo: 3,
    turns: 6,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: SONNET,
    prompt: 'Migrate config files to schema v2',
    daysAgo: 4,
    turns: 8,
  },
  {
    project: 'OpenWaggle',
    origin: 'pi-cli',
    model: GEMINI,
    prompt: 'Summarize the open Electron issues',
    daysAgo: 5,
    turns: 3,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Split the note list into pages',
    daysAgo: 6,
    turns: 6,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: HAIKU,
    prompt: 'Rename the sync module',
    daysAgo: 7,
    turns: 3,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Draft the changelog entry',
    daysAgo: 8,
    turns: 4,
  },
  {
    project: 'jotter',
    origin: 'pi-cli',
    model: SONNET,
    prompt: 'Explain the attachment upload flow',
    daysAgo: 9,
    turns: 5,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: GPT,
    prompt: 'Add tags to the note search',
    daysAgo: 11,
    turns: 7,
    compacted: true,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: SONNET,
    prompt: 'Find the TODOs left in the API client',
    daysAgo: 12,
    turns: 4,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Fix the offline banner flicker',
    daysAgo: 13,
    turns: 5,
  },
  {
    project: 'OpenWaggle',
    origin: 'pi-cli',
    model: GPT,
    prompt: 'Write a script that lists stale branches',
    daysAgo: 14,
    turns: 3,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: SONNET,
    prompt: 'Add keyboard shortcuts for note actions',
    daysAgo: 16,
    turns: 6,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: GEMINI,
    prompt: 'Compare two markdown parsers for notes',
    daysAgo: 17,
    turns: 4,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Move app preferences to SQLite',
    daysAgo: 18,
    turns: 8,
  },
  {
    project: 'jotter',
    origin: 'pi-cli',
    model: HAIKU,
    prompt: 'Format the README tables',
    daysAgo: 20,
    turns: 2,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: GPT,
    prompt: 'Export notes as a zip file',
    daysAgo: 21,
    turns: 6,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: SONNET,
    prompt: 'Review API client error handling',
    daysAgo: 23,
    turns: 5,
  },
  {
    project: 'jotter',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Set up end-to-end sync tests',
    daysAgo: 24,
    turns: 7,
  },
  {
    project: 'jotter',
    origin: 'pi-cli',
    model: GPT,
    prompt: 'Profile the note list render',
    daysAgo: 26,
    turns: 3,
  },
  {
    project: 'OpenWaggle',
    origin: 'openwaggle',
    model: OPUS,
    prompt: 'Plan the Hive panel redesign',
    daysAgo: 27,
    turns: 5,
  },
]
