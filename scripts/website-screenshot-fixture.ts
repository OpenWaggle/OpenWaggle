import { seedSingleSession } from '../e2e/support/session-fixtures'

export const PROJECT_NAME = 'OpenWaggle'
export const THREAD_TITLE = 'review this waggle fix before merge'
export const THREAD_LIST_MATCHER = /review this waggle/i

const THREAD_PROMPT =
  'I just fixed the waggle streaming regression. Please review the changes, challenge the risky parts, and tell me whether this branch is ready to merge.'
const WAGGLE_MAX_TURNS_SAFETY = 5
const USER_MESSAGE_OFFSET_MS = 7_000
const OPENING_ADVOCATE_OFFSET_MS = 6_000
const FIRST_CRITIC_OFFSET_MS = 5_000
const SECOND_ADVOCATE_OFFSET_MS = 4_000
const SECOND_CRITIC_OFFSET_MS = 3_000
const FINAL_ADVOCATE_OFFSET_MS = 2_000
const SECOND_ADVOCATE_TURN_NUMBER = 2
const SECOND_CRITIC_TURN_NUMBER = 3
const FINAL_ADVOCATE_TURN_NUMBER = 4

type AgentLabel = 'Advocate' | 'Critic'

interface MarketingAssistantTurn {
  readonly id: string
  readonly label: AgentLabel
  readonly model: string
  readonly offsetMs: number
  readonly turnNumber: number
  readonly lines: readonly string[]
}

const MARKETING_ASSISTANT_TURNS: readonly MarketingAssistantTurn[] = [
  {
    id: 'website-assistant-1',
    label: 'Advocate',
    model: 'claude-opus-4-6',
    offsetMs: OPENING_ADVOCATE_OFFSET_MS,
    turnNumber: 0,
    lines: [
      "I'll review this the way a careful teammate would: verify the renderer behavior, trace the IPC normalization, and confirm the branch is actually safe to merge.",
      '',
      '**Initial review sweep**',
      '',
      '- Read the waggle IPC handler and streaming normalization path',
      '- Read the chat row builder and scroll behavior hooks',
      '- Check the tests that were added for navigation, live streaming, and restore behavior',
      '',
      "What I'm looking for is straightforward: does the branch actually fix the live waggle rendering regression, or did it just move the problem around? I also want to confirm the new scroll behavior doesn't introduce fresh navigation weirdness.",
      '',
      '**Next verification pass**',
      '',
      '- Inspect how stable message IDs are enforced across tool continuations',
      '- Compare live transcript behavior against persisted reload behavior',
      '- Verify that per-thread scroll restore does not suppress normal send-anchor UX',
    ],
  },
  {
    id: 'website-assistant-2',
    label: 'Critic',
    model: 'claude-sonnet-4-6',
    offsetMs: FIRST_CRITIC_OFFSET_MS,
    turnNumber: 1,
    lines: [
      "I'm less worried about the happy path and more worried about merge readiness. These kinds of fixes often look great in manual testing while hiding edge-case regressions in tool rendering, reloads, or thread switching.",
      '',
      '**Risk areas I want challenged**',
      '',
      '- Live message attribution can still drift when turns hydrate in multiple passes',
      '- Scroll restoration can interfere with the "scroll user message near top" behavior if the timing is off',
      '- Temporary debug instrumentation or devtools visibility could accidentally leak into polished captures or production builds',
      '',
      "So my standard is stricter than 'looks fixed.' I want evidence that the branch is reliable under realistic navigation, reload, and review workflows before we call it merge-ready.",
    ],
  },
  {
    id: 'website-assistant-3',
    label: 'Advocate',
    model: 'claude-opus-4-6',
    offsetMs: SECOND_ADVOCATE_OFFSET_MS,
    turnNumber: SECOND_ADVOCATE_TURN_NUMBER,
    lines: [
      "The Critic is asking the right merge question, so I drilled into the implementation details instead of relying on screenshots alone. The strongest sign here is that the fix doesn't live in one place; it coordinates stream normalization, row building, and scroll policy together.",
      '',
      '**What I verified in code**',
      '',
      '- The waggle stream now normalizes repeated text events into stable assistant message IDs per turn',
      '- The renderer prefers live waggle metadata and skips empty label-only assistant rows',
      '- The scroll hook now restores per-thread position and blocks navigation-triggered anchor jumps while preserving normal send-anchor behavior',
      '',
      "That shape matters. It tells me this wasn't a cosmetic patch; it was a systems fix that aligns the backend stream contract with what the transcript renderer expects. That's a much better sign for merge confidence.",
    ],
  },
  {
    id: 'website-assistant-4',
    label: 'Critic',
    model: 'claude-sonnet-4-6',
    offsetMs: SECOND_CRITIC_OFFSET_MS,
    turnNumber: SECOND_CRITIC_TURN_NUMBER,
    lines: [
      "I agree the implementation is much cleaner now, but I still want to judge it like a skeptical reviewer. The remaining question isn't whether the main bug is improved; it's whether the branch is defended against regression.",
      '',
      '**What would convince me**',
      '',
      '- Targeted tests for repeated waggle turn chunks, row cleanup, and thread-navigation restore',
      '- A realistic end-to-end check where you switch threads, return, and still get normal user-message anchoring on a new send',
      '- Clean output with the debug tracing and visible devtools affordances removed once the investigation is over',
      '',
      "If those safeguards are in place, then I'm comfortable saying the branch is not only fixed but responsibly hardened. Without them, this is still the sort of UI regression that could come back the next time the transcript code gets touched.",
    ],
  },
  {
    id: 'website-assistant-5',
    label: 'Advocate',
    model: 'claude-opus-4-6',
    offsetMs: FINAL_ADVOCATE_OFFSET_MS,
    turnNumber: FINAL_ADVOCATE_TURN_NUMBER,
    lines: [
      'Excellent. After weighing the implementation and the reviewer concerns together, I think the answer is yes: this branch looks ready to merge, provided the verification pass stays green and the temporary debugging affordances are removed.',
      '',
      '**Advocate merge recommendation**',
      '',
      'The main regression fix is real: live waggle turns render coherently, per-thread scroll memory behaves properly, and the transcript no longer jumps back to the initiating user message on navigation.',
      '',
      "What pushes it over the line is the hardening around it: regression coverage, cleaner screenshot output, and a more predictable capture flow for the website. That's the kind of follow-through that makes a fix safe to land instead of merely impressive in a demo.",
    ],
  },
]

function makeWaggleMetadata(agentLabel: AgentLabel, turnNumber: number) {
  const isAdvocate = agentLabel === 'Advocate'

  return {
    agentIndex: isAdvocate ? 0 : 1,
    agentLabel,
    agentColor: isAdvocate ? 'blue' : 'amber',
    agentModel: isAdvocate ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
    turnNumber,
  }
}

function buildMarketingMessages(now: number) {
  return [
    {
      id: 'website-user-1',
      role: 'user',
      createdAt: now - USER_MESSAGE_OFFSET_MS,
      parts: [{ type: 'text', text: THREAD_PROMPT }],
    },
    ...MARKETING_ASSISTANT_TURNS.map((turn) => ({
      id: turn.id,
      role: 'assistant',
      model: turn.model,
      createdAt: now - turn.offsetMs,
      metadata: { waggle: makeWaggleMetadata(turn.label, turn.turnNumber) },
      parts: [{ type: 'text', text: turn.lines.join('\n') }],
    })),
  ]
}

export async function seedMarketingSession(userDataDir: string, projectPath: string) {
  console.info('[website-shots] seeding marketing session')
  const now = Date.now()

  await seedSingleSession(userDataDir, {
    title: THREAD_TITLE,
    projectPath,
    updatedAt: now,
    waggleConfig: {
      mode: 'sequential',
      agents: [
        {
          label: 'Advocate',
          model: 'claude-opus-4-6',
          roleDescription: 'Argues for the strongest technical case',
          color: 'blue',
        },
        {
          label: 'Critic',
          model: 'claude-sonnet-4-6',
          roleDescription: 'Challenges assumptions and validates evidence',
          color: 'amber',
        },
      ],
      stop: {
        primary: 'consensus',
        maxTurnsSafety: WAGGLE_MAX_TURNS_SAFETY,
      },
    },
    messages: buildMarketingMessages(now),
  })
}
