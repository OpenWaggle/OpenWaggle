import { seedSingleConversation } from './conversation-fixtures'

/**
 * 600+ word assistant response that generates enough vertical height
 * to push the conversation well beyond the viewport.
 */
export const LONG_ASSISTANT_TEXT = `I'll walk you through a comprehensive analysis of the project architecture, covering all major subsystems and their interactions.

## Module Structure

The application follows a layered architecture with clear separation of concerns. The main process handles all system-level operations including file I/O, process management, and database access. The renderer process is responsible for the user interface and communicates with the main process exclusively through typed IPC channels.

### Data Layer

The persistence layer uses SQLite for structured storage. Conversations, messages, and message parts are stored in normalized tables with foreign key constraints. Each conversation has a unique identifier, a title, timestamps, and an optional project path. Messages belong to conversations and carry role information (user or assistant), optional model metadata, and ordered parts.

Message parts use a discriminated union pattern with a part type field and a JSON content column. Supported part types include text, reasoning, thinking, attachment, tool-call, and tool-result. This design allows flexible content representation while maintaining query efficiency through the relational model.

### Agent Loop

The agent loop orchestrates multi-turn conversations with language models. It receives user messages, constructs prompts with system instructions and conversation history, and streams responses from the selected provider. During streaming, the loop emits typed events that the renderer consumes to update the UI in real time.

Tool execution is integrated into the streaming pipeline. When the model requests a tool call, the loop validates the input schema, checks approval requirements, executes the tool, and feeds the result back into the conversation. This creates a recursive pattern where a single user message can trigger multiple rounds of model inference and tool execution.

### Provider Registry

The provider registry is a singleton that manages all LLM provider integrations. Each provider implements a common interface that includes model listing, adapter creation, and capability declaration. At startup, all providers are registered and their model lists are made available to the renderer through an IPC channel.

Adapter creation is deferred until a conversation actually needs to communicate with a specific model. This lazy initialization pattern reduces startup time and memory usage for providers that are configured but not actively used.

### Tool System

Tools are defined using a wrapper around the TanStack AI tool definition API. Each tool declares an Effect Schema for input validation, which serves double duty as both runtime validation and JSON Schema generation for the model. Tool execution receives a context object that provides access to the project path, conversation state, and approval mechanisms.

The approval system implements a trust chain where tools that modify the file system or execute commands require explicit user approval. Approvals can be persisted as trust rules scoped to a project path and tool name, allowing frequently used operations to be auto-approved in subsequent conversations.

### Renderer Architecture

The renderer uses React 19 with Zustand for state management and Tailwind CSS for styling. State is divided into focused stores: the chat store manages conversations and streaming state, while the settings store handles user preferences and API configuration.

The chat transcript uses react-virtuoso for virtualized rendering of potentially long conversations. Virtual rows are computed from messages and decorated with metadata like streaming status, turn dividers, and waggle agent information. This computation is memoized to avoid unnecessary recalculation during streaming updates.

### IPC Type System

All inter-process communication is governed by a single type definition file that declares three channel maps: invoke channels for request-response patterns, send channels for fire-and-forget messages, and event channels for main-to-renderer broadcasts. The preload bridge implements typed wrappers that ensure compile-time safety across the process boundary.

This architecture ensures that adding a new IPC channel requires updating a single source of truth, with TypeScript catching any mismatches between the main process handler and the renderer consumer at build time rather than runtime.

## Performance Considerations

The React Compiler handles automatic memoization, eliminating the need for manual React.memo, useMemo, or useCallback calls. Streaming text rendering uses requestAnimationFrame batching to coalesce rapid token updates into a single DOM write per frame. Zustand selectors are kept granular to minimize re-render scope during high-frequency streaming updates.

This comprehensive architecture supports a responsive, multi-model coding agent experience while maintaining type safety and clear process boundaries throughout the entire application stack.`

export const SCROLL_THREAD_TITLE = 'Scroll Regression'

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
