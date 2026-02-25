# 41 — Personalization

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Multi-agent conversation review — SettingsNav has disabled "Personalization" tab (line 25), CommandPalette has "Personality" no-op (line 138-143), `SettingsTab` type includes `'personalization'` (ui-store.ts line 11)

---

## Problem

Users cannot customize how the agent communicates. There is no mechanism for:

1. **Custom instructions**: Persistent instructions that apply to all conversations (e.g., "Always use TypeScript", "Prefer functional patterns", "Explain your reasoning")
2. **Tone/style preferences**: Formal vs casual, verbose vs concise, senior vs beginner level
3. **Project-level conventions**: Things the agent should always know about this codebase that aren't in CLAUDE.md
4. **Response format preferences**: Markdown style, code block preferences, language preferences

The product has three dead-end UI touchpoints for this feature:
- `CommandPalette.tsx` line 138-143: `personality` command — `action: () => closeCommandPalette()` (no-op)
- `SettingsNav.tsx` line 25: `personalization` tab — `enabled: false`
- `ui-store.ts` line 11: `SettingsTab` type includes `'personalization'` but `SettingsPage.tsx` has no handler for it (falls through to "Coming soon")

### What Exists in the Codebase

- **CLAUDE.md**: Project-level agent instructions that are injected into the system prompt. This is the closest thing to personalization, but it's per-project and aimed at coding conventions, not user preferences.
- **Skills system**: Skills inject behavior into agent runs, but they're task-specific, not preference-specific.
- **System prompt pipeline** (`src/main/agent/system-prompt.ts`, `prompt-pipeline.ts`): Already supports composing system prompts from multiple sources — adding a personalization block is architecturally straightforward.

### Reference: How other tools do this

| Tool | Personalization |
|------|----------------|
| ChatGPT | "Custom Instructions" — two fields: "What would you like ChatGPT to know about you?" and "How would you like ChatGPT to respond?" |
| Claude.ai | "Custom Instructions" in settings — freeform text injected into system prompt |
| Cursor | "Rules for AI" in settings — project-level and global rules |
| Aider | `.aider.conf.yml` — conventions file in project root |

## Architecture

### Storage

Personalization data is **user-global** (not per-conversation, not per-project):

```typescript
interface PersonalizationConfig {
  /** Freeform text injected into every system prompt */
  customInstructions: string
  /** Predefined tone preset */
  tone: 'default' | 'concise' | 'detailed' | 'formal' | 'casual'
  /** Preferred response language (e.g., 'en', 'es', 'ja') */
  responseLanguage: string
  /** Whether to show thinking/reasoning */
  showReasoning: boolean
}
```

Stored via `electron-store` alongside other settings (API keys, model selection). Not in conversation JSON files.

### System Prompt Integration

The personalization block is injected into the system prompt **after** the base prompt and **before** project-specific context (CLAUDE.md, skills):

```
[Base system prompt]
[Personalization block — custom instructions + tone + language]
[Project context — CLAUDE.md, standards]
[Active skills]
[Plan mode modifier, if active]
```

This ordering ensures user preferences are respected but can be refined by project-specific rules.

## Implementation

### Phase 1: Core personalization storage

- [ ] Add `PersonalizationConfig` type to `src/shared/types/settings.ts` or new file
- [ ] Store personalization in `electron-store` settings (same mechanism as API keys)
- [ ] Add IPC channels:
  - `'settings:get-personalization'` → returns `PersonalizationConfig`
  - `'settings:set-personalization'` → saves updated config
- [ ] Default config: empty custom instructions, `tone: 'default'`, `responseLanguage: 'en'`, `showReasoning: false`

### Phase 2: System prompt injection

- [ ] In `src/main/agent/system-prompt.ts` or `prompt-pipeline.ts`:
  - Read personalization config from settings store
  - Build personalization prompt block:
    ```
    USER PREFERENCES:
    - Tone: concise
    - Language: English
    - Custom instructions: Always use TypeScript. Prefer functional patterns over classes.
    ```
  - Inject into composed system prompt at correct position
- [ ] Only inject non-default values (don't inject "Tone: default")

### Phase 3: Settings UI

- [ ] Enable `personalization` tab in `SettingsNav.tsx` (change `enabled: false` → `enabled: true`)
- [ ] Create `src/renderer/src/components/settings/sections/PersonalizationSection.tsx`:
  - **Custom Instructions** textarea: freeform text, placeholder with examples
  - **Tone** select: Default / Concise / Detailed / Formal / Casual
  - **Response Language** select: Common languages
  - **Show Reasoning** toggle
  - Live preview of how the system prompt block will look
- [ ] Add `PersonalizationSection` case to `SettingsPage.tsx` tab content switch
- [ ] Wire the `personality` command in `CommandPalette.tsx` to open settings at personalization tab:
  ```typescript
  action: () => { closeCommandPalette(); openSettings('personalization'); }
  ```

### Phase 4: Per-project overrides (optional)

- [ ] Allow `.openwaggle/personalization.md` in project root for project-scoped overrides
- [ ] Merge: global preferences provide defaults, project file overrides specific fields
- [ ] Show indicator in personalization settings when project override is active

## Files to Create

- `src/renderer/src/components/settings/sections/PersonalizationSection.tsx` — settings tab content

## Files to Modify

- `src/shared/types/settings.ts` — add `PersonalizationConfig`
- `src/main/agent/system-prompt.ts` or `prompt-pipeline.ts` — personalization injection
- `src/renderer/src/components/settings/SettingsNav.tsx` — enable personalization tab (line 25)
- `src/renderer/src/components/settings/SettingsPage.tsx` — add PersonalizationSection to tab switch
- `src/renderer/src/components/command-palette/CommandPalette.tsx` — wire personality command (line 138-143)
- `src/shared/types/ipc.ts` — personalization IPC channels

## Tests

- Unit: personalization block injected into system prompt when custom instructions set
- Unit: empty/default config produces no injection
- Unit: personalization persists across app restart (electron-store)
- Component: settings tab renders all personalization fields
- Component: personality command in palette opens personalization settings
