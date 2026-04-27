import { seedConversations, seedSingleConversation } from './conversation-fixtures'

/**
 * 600+ word assistant response that generates enough vertical height
 * to push the conversation well beyond the viewport.
 */
export const LONG_ASSISTANT_TEXT = `I'll walk you through a comprehensive analysis of the project architecture, covering all major subsystems and their interactions.

## Module Structure

The application follows a layered architecture with clear separation of concerns. The main process handles all system-level operations including file I/O, process management, and database access. The renderer process is responsible for the user interface and communicates with the main process exclusively through typed IPC channels.

### Data Layer

The persistence layer uses SQLite for structured storage. Sessions, nodes, branches, branch state, and UI state are stored in normalized tables with foreign key constraints. Each session has a unique OpenWaggle identifier, Pi session metadata, a title, timestamps, and an optional project path. Nodes belong to sessions and carry Pi entry metadata, role information, ordered content, and branch hints.

Session node content uses discriminated message-part shapes with JSON content columns. Supported UI parts include text, thinking, attachments, tool calls, tool results, and compaction summaries. This design allows flexible transcript projection while maintaining query efficiency through the relational model.

### Agent Loop

The agent loop orchestrates multi-turn conversations with language models. It receives user messages, constructs prompts with system instructions and conversation history, and streams responses from the selected provider. During streaming, the loop emits typed events that the renderer consumes to update the UI in real time.

Tool execution is integrated into Pi's native streaming pipeline. When Pi emits a tool-call event, the main process projects the OpenWaggle-owned transport event and the renderer updates the transcript incrementally. This creates a recursive pattern where a single user message can trigger multiple rounds of model inference and Pi-native tool execution.

### Provider Catalog

Provider, model, and auth metadata come from Pi runtime services through adapter ports. OpenWaggle owns the settings and selection UI. At startup and project changes, Pi-derived model lists are made available to the renderer through typed IPC.

Runtime session creation is deferred until a conversation actually needs to communicate with a specific model. This lazy initialization pattern reduces startup time and keeps provider-specific behavior behind the Pi adapter boundary.

### Pi Tool Surface

OpenWaggle renders Pi-emitted native tool events such as file reads, writes, edits, shell commands, and search/listing tools. Tool availability and execution behavior come from Pi runtime services, while OpenWaggle owns the transcript projection and UI presentation.

### Renderer Architecture

The renderer uses React 19 with Zustand for state management and Tailwind CSS for styling. State is divided into focused stores: the chat store manages conversations and streaming state, while the settings store handles user preferences and API configuration.

The chat transcript renders session workspaces as ordered rows derived from the active transcript path and live streaming tail. Rows are decorated with metadata like streaming status, turn dividers, compaction summaries, and Waggle agent information. Focused Zustand selectors keep streaming updates scoped to the transcript surface.

### IPC Type System

All inter-process communication is governed by a single type definition file that declares three channel maps: invoke channels for request-response patterns, send channels for fire-and-forget messages, and event channels for main-to-renderer broadcasts. The preload bridge implements typed wrappers that ensure compile-time safety across the process boundary.

This architecture ensures that adding a new IPC channel requires updating a single source of truth, with TypeScript catching any mismatches between the main process handler and the renderer consumer at build time rather than runtime.

## Performance Considerations

The React Compiler handles automatic memoization, eliminating the need for manual React.memo, useMemo, or useCallback calls. Streaming text renders through the same markdown path as completed assistant text. Zustand selectors are kept granular to minimize re-render scope during high-frequency streaming updates.

This comprehensive architecture supports a responsive, multi-model coding agent experience while maintaining type safety and clear process boundaries throughout the entire application stack.`

export const SCROLL_THREAD_TITLE = 'Scroll Regression'
export const NAV_SCROLL_THREAD_TITLE_A = 'Scroll Navigation A'
export const NAV_SCROLL_THREAD_TITLE_B = 'Scroll Navigation B'
export const NAV_THREAD_B_USER_MARKER = 'B marker: user content for scroll navigation regression'
const NAV_LONG_ASSISTANT_TEXT = `${LONG_ASSISTANT_TEXT}\n\n${LONG_ASSISTANT_TEXT}\n\n${LONG_ASSISTANT_TEXT}`

/**
 * Seeds a conversation with 3 messages: user → long assistant → user.
 * This lets us verify that the LAST user message is scrolled near the top
 * when the conversation is opened, exercising the scroll-to-user-message
 * behavior without needing a live LLM call.
 */
/**
 * Seeds a conversation with 1 user message + 1 long assistant response.
 * The long text pushes the chat container far below the viewport, so any
 * subsequent user message must be scrolled back to the top to be readable.
 */
export async function makeScrollRegressionConversation(userDataDir: string): Promise<void> {
  const now = Date.now()

  await seedSingleConversation(userDataDir, {
    title: SCROLL_THREAD_TITLE,
    updatedAt: now,
    messages: [
      {
        id: 'user-msg-scroll-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Explain the project architecture in detail' }],
        createdAt: now - 2,
      },
      {
        id: 'assistant-msg-scroll-1',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        parts: [{ type: 'text', text: LONG_ASSISTANT_TEXT }],
        createdAt: now - 1,
      },
    ],
  })
}

/**
 * Seeds two conversations used to verify per-thread scroll restoration.
 * Thread A is intentionally long enough to be scrollable.
 */
export async function makeThreadNavigationScrollConversations(userDataDir: string): Promise<void> {
  const now = Date.now()
  const earlierTimestamp = now - 10
  const laterTimestamp = now - 5

  await seedConversations(userDataDir, [
    {
      title: NAV_SCROLL_THREAD_TITLE_A,
      updatedAt: now,
      messages: [
        {
          id: 'user-msg-nav-a-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Please explain OpenWaggle in detail.' }],
          createdAt: earlierTimestamp,
        },
        {
          id: 'assistant-msg-nav-a-1',
          role: 'assistant',
          model: 'claude-opus-4-6',
          parts: [{ type: 'text', text: NAV_LONG_ASSISTANT_TEXT }],
          createdAt: laterTimestamp,
        },
      ],
    },
    {
      title: NAV_SCROLL_THREAD_TITLE_B,
      updatedAt: now - 1,
      messages: [
        {
          id: 'user-msg-nav-b-1',
          role: 'user',
          parts: [{ type: 'text', text: NAV_THREAD_B_USER_MARKER }],
          createdAt: earlierTimestamp,
        },
        {
          id: 'assistant-msg-nav-b-1',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          parts: [{ type: 'text', text: 'Acknowledged. This is thread B.' }],
          createdAt: laterTimestamp,
        },
      ],
    },
  ])
}
