# Spec 11 — Ship OpenWaggle to Users

**Goal**: Get OpenWaggle from local dev project to publicly downloadable product. Users can discover it (website), download it (GitHub Releases + platform installers), install it, and get help (docs + community).

**Inspiration**: OpenClaw (https://openclaw.ai/) — adapted for desktop Electron app distribution rather than CLI.

**Status**: Planned

---

## Prerequisites (Manual / External)

These require human action before implementation can fully proceed:

- [ ] **Apple Developer Program enrollment** ($99/year) — needed for macOS code signing + notarization. Without it, Gatekeeper blocks unsigned apps. First release can ship unsigned (users right-click > Open).
- [ ] **Create GitHub org** `openwaggle` — public home for the project
- [ ] **Register domain** `openwaggle.ai` — website + docs
- [ ] **Create Discord server** — community support channel

---

## Phase 1: Repository & Release Foundation

### 1.1 Public Repository Setup
- [ ] Create GitHub org `openwaggle`
- [ ] Push repo to `openwaggle/openwaggle` (public)
- [ ] Create `README.md`
  - Product intro + logo lockup (`build/branding/openwaggle-logo-lockup.svg`)
  - Feature list (multi-model, agent tools, terminal, git, orchestration, skills, voice)
  - Download section with platform badges
  - Quick start (download → install → open project → configure provider → chat)
  - Supported models table (all 6 providers)
  - Development setup section
- [ ] Create `LICENSE` — MIT
- [ ] Create `CONTRIBUTING.md`
  - Prerequisites: Node.js 22+, pnpm 10+
  - Dev setup: `pnpm install && pnpm dev`
  - Branch naming: `<type>/<slug>` (feat, fix, refactor, test, docs, chore)
  - Commit format: `<type>(<scope>): <description>`
  - Code conventions: no `any`, no `React.FC`, no `forwardRef`, use `cn()`, use structured logger, Biome enforced
  - Testing: `pnpm test` before PR
  - Link to AGENTS.md for architecture details
- [ ] Create `SECURITY.md` — supported versions, email for vulnerability reports, response SLA
- [ ] Create `CHANGELOG.md` — start with v0.1.0 entry
- [ ] Create `.github/ISSUE_TEMPLATE/bug_report.yml` — version, OS, steps, expected/actual, logs
- [ ] Create `.github/ISSUE_TEMPLATE/config.yml` — route feature requests to GitHub Discussions

### 1.2 Code Signing (macOS)
**Blocked on**: Apple Developer Program enrollment

- [ ] Create `build/entitlements.mac.plist`:
  - `com.apple.security.cs.allow-jit` (node-pty)
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.device.audio-input` (Whisper voice input)
  - `com.apple.security.cs.disable-library-validation` (native addons)
- [ ] Update `electron-builder.yml` mac section:
  - Add `hardenedRuntime: true`
  - Add `entitlements: build/entitlements.mac.plist`
  - Add `entitlementsInherit: build/entitlements.mac.plist`
  - Add `notarize: true`
- [ ] **After enrollment**: Generate certs, export .p12, configure GitHub secrets

Windows signing: Deferred. Users click through SmartScreen warning initially.
Linux: No signing needed for AppImage.

### 1.3 Auto-Updates
- [ ] Install `electron-updater`: `pnpm add electron-updater`
- [ ] Add publish config to `electron-builder.yml`:
  ```yaml
  publish:
    - provider: github
      owner: openwaggle
      repo: openwaggle
      releaseType: release
  ```
- [ ] Create `src/main/updater.ts`:
  - Use `createLogger('updater')` (follow existing logger pattern)
  - Listen to: `checking-for-update`, `update-available`, `update-not-available`, `update-downloaded`, `error`
  - Export `initAutoUpdater()` function
  - Emit IPC events to renderer for UI notifications
- [ ] Add IPC channels in `src/shared/types/ipc.ts`:
  - `IpcEventChannelMap`: `'app:update-available'`, `'app:update-downloaded'`
  - `IpcInvokeChannelMap`: `'app:check-for-updates'`, `'app:install-update'`
- [ ] Wire `initAutoUpdater()` in `src/main/index.ts` — call after `createWindow()`
- [ ] Add renderer UI: notification banner when update downloaded, "Restart to Update" button
- [ ] Add `dev-app-update.yml` to `.gitignore` (local dev testing config)

**Key files modified**: `package.json`, `electron-builder.yml`, `src/main/index.ts`, `src/shared/types/ipc.ts`
**Key files created**: `src/main/updater.ts`, `build/entitlements.mac.plist`

**Note**: macOS auto-updates require code signing. Until Apple enrollment clears, auto-updates only work on Windows/Linux.

### 1.4 In-App Feedback System

Users who hit a bug and can't easily report it just leave. This gives them a zero-friction path to submit bugs and suggestions directly from the app, creating GitHub issues automatically.

**How it works:**
1. User clicks "Send Feedback" (Help menu, error display, or Cmd+Shift+F)
2. Simple dialog: type (Bug / Suggestion), title, description
3. If triggered from an error, pre-fills error message + stack trace
4. Auto-attaches metadata (user can review before sending):
   - App version (from `package.json`)
   - OS + arch (`process.platform`, `process.arch`)
   - Active provider + model
   - Last error message (if any)
   - Recent log tail (last 50 lines from `getLogFilePath()`)
5. Uses `gh issue create --repo openwaggle/openwaggle` to submit
6. If `gh` CLI not installed: falls back to opening GitHub new issue URL in browser with pre-filled query params

**Implementation:**
- [ ] Create `src/main/feedback/submit-feedback.ts`
  - `checkGhAvailable()` — run `gh --version`, return boolean
  - `getRecentLogs(lines: number)` — read last N lines from today's log file via `getLogFilePath()`
  - `collectMetadata()` — app version, OS, arch, provider, model
  - `submitFeedback(type, title, description, metadata, logs)`:
    - If `gh` available: `gh issue create --repo openwaggle/openwaggle --title "..." --body "..." --label bug|enhancement`
    - If not: build GitHub URL with `title` + `body` query params, open via `shell.openExternal()`
  - Returns: `{ success: boolean, issueUrl?: string, fallback?: 'browser' }`
- [ ] Create `src/renderer/src/components/feedback/FeedbackDialog.tsx`
  - Type selector: Bug / Suggestion
  - Title input
  - Description textarea (pre-filled with error context if triggered from error)
  - Collapsible "Attached context" section showing metadata + logs (user can review/edit before sending)
  - "Include recent logs" checkbox (default: on for bugs, off for suggestions)
  - Submit button → IPC → main process
  - Success state: "Issue #42 created — thanks!" with link
  - Fallback state: "Opening GitHub in your browser..."
- [ ] Add IPC channel in `src/shared/types/ipc.ts`:
  - `IpcInvokeChannelMap`: `'app:submit-feedback'` — `{ type, title, description, includeLogs } => { success, issueUrl?, fallback? }`
  - `IpcInvokeChannelMap`: `'app:check-gh-available'` — `{} => boolean`
- [ ] Wire feedback trigger points:
  - Help menu → "Send Feedback"
  - `ChatErrorDisplay.tsx` → "Report this issue" button (pre-fills error message + logs)
  - Keyboard shortcut: Cmd+Shift+F (or similar)
  - Settings panel → "Feedback" link

**Log attachment format in issue body:**
```markdown
## Description
[user's description]

## Environment
- **App version**: 0.1.0
- **OS**: macOS 15.3 (arm64)
- **Provider**: Anthropic
- **Model**: claude-sonnet-4-5
- **Execution mode**: sandbox

## Error Context
[pre-filled if triggered from error]

<details>
<summary>Recent logs (last 50 lines)</summary>

```
[log content from getLogFilePath()]
```

</details>
```

**Key files created**: `src/main/feedback/submit-feedback.ts`, `src/renderer/src/components/feedback/FeedbackDialog.tsx`
**Key files modified**: `src/shared/types/ipc.ts`, `src/main/ipc/` (new handler), `src/renderer/src/components/chat/ChatErrorDisplay.tsx`

---

### 1.5 First-Run UX Polish

These are small fixes that prevent first-time users from bouncing:

- [ ] **Pre-flight API key check**: Before sending a message, verify the selected model's provider has an API key configured. If not, show inline prompt: "Configure your [Provider] API key in Settings to start chatting" with a Settings button. Don't let the message attempt send.
- [ ] **Welcome screen improvement**: If no provider has an API key, welcome screen should prominently show "Step 1: Add an API key" with a button to Settings, above the project selection.
- [ ] **App menu**: Add standard menu bar (File, Edit, View, Help):
  - File: New Conversation, Open Project, Recent Projects, Settings, Quit
  - Edit: Undo, Redo, Cut, Copy, Paste, Select All
  - View: Toggle Sidebar, Toggle Terminal, Toggle Diff Panel, Actual Size, Zoom In/Out
  - Help: Documentation (opens docs URL), Keyboard Shortcuts, Send Feedback, About OpenWaggle
- [ ] **About dialog**: Show app name, version, logo, license, GitHub link
- [ ] **Window title**: Update to show project name: "OpenWaggle — [project-name]"

### 1.6 UX Hardening

Small but important quality fixes that prevent bad reviews:

- [ ] **Offline detection**: Check `navigator.onLine` before sending messages. If offline, show inline message: "No internet connection. Check your network and try again." Also listen for `online`/`offline` events to update state reactively. Ollama (local) should still work offline — only block cloud providers.
- [ ] **Conversation export**: Add "Export conversation" option in conversation context menu (sidebar right-click or overflow menu). Exports as Markdown file via `dialog.showSaveDialog()`. Format: messages with role labels, tool calls summarized, code blocks preserved. Simple and useful for sharing or backup.
- [ ] **Better rate limit errors**: Improve the existing "You hit a rate limit" message to include:
  - Which provider hit the limit
  - Suggested action: "Try again in a few minutes, switch to a different model, or use OpenRouter for automatic fallback"
  - If multiple providers are configured, offer a one-click "Switch to [other model]" button
- [ ] **Keyboard shortcuts panel**: Add a "Keyboard Shortcuts" dialog accessible from Help menu (and via `Cmd+/` or `Cmd+Shift+/`). List all available shortcuts in a clean two-column layout. Read shortcuts from a single source-of-truth map so the dialog stays in sync with actual bindings.
- [ ] **Hide unfinished settings tabs**: Remove or hide any settings tabs that render "Coming soon" placeholder content. Only show tabs that have real, functional UI. Users seeing placeholder content assume the app is broken or abandoned.
- [ ] **Improve rate limit error in error classifier**: Update `src/main/agent/error-classifier.ts` to extract provider name from error context and include it in the user-facing message.

---

## Phase 2: CI/CD Pipeline

### 2.1 CI Workflow
- [ ] Create `.github/workflows/ci.yml`
  - Triggers: push to `main`, pull requests to `main`
  - Job 1 — Lint & typecheck: `pnpm check` (runs `typecheck + lint`)
  - Job 2 — Tests: `pnpm test:unit && pnpm test:integration`
  - Setup: `pnpm/action-setup@v4`, `actions/setup-node@v4` (Node 22), pnpm cache

### 2.2 Release Workflow
- [ ] Create `.github/workflows/release.yml`
  - Triggers: tag push `v*`
  - **build-macos** job: `macos-latest`, matrix `[x64, arm64]`
    - Signs + notarizes (when certs available)
    - Uploads DMG artifacts
  - **build-windows** job: `windows-latest`
    - Builds NSIS installer
    - Uploads EXE artifact
  - **build-linux** job: `ubuntu-latest`
    - Builds AppImage
    - Uploads artifact
  - **publish-release** job: `needs: [build-macos, build-windows, build-linux]`
    - Downloads all artifacts
    - Creates **draft** GitHub Release with all binaries
    - Uses `softprops/action-gh-release@v2`

### 2.3 Release Process
1. `pnpm version patch|minor|major` (bumps `package.json`, creates git tag)
2. `git push origin main --tags`
3. CI builds all platforms, creates draft release
4. Maintainer reviews, edits release notes, publishes
5. `electron-updater` in existing installations picks up new version

### 2.4 GitHub Secrets
- [ ] `MAC_CSC_LINK` — base64-encoded .p12 certificate
- [ ] `MAC_CSC_KEY_PASSWORD` — certificate password
- [ ] `APPLE_ID` — Apple Developer account email
- [ ] `APPLE_APP_SPECIFIC_PASSWORD` — for notarization
- [ ] `APPLE_TEAM_ID` — Apple Developer Team ID

---

## Phase 3: Website

### 3.1 Tech Stack
- **Astro** — static-first, fast, lightweight, MDX support for docs
- **Tailwind v4** — consistent with the app's styling
- **Deployed on Vercel** (free tier) or Cloudflare Pages
- **Separate repo**: `openwaggle/openwaggle.ai`
- **Domain**: `openwaggle.ai`

### 3.2 Site Structure
```
/                → Landing page
/download        → Platform-detected download page
/docs            → User documentation
/changelog       → Release history
/privacy         → Privacy policy
```

### 3.3 Landing Page
- [ ] **Hero**: Logo lockup + tagline + "Download for [detected OS]" CTA
- [ ] **Features**: 6 cards — Multi-model, Agent tools, Built-in terminal, Git integration, Task orchestration, Skills extensibility
- [ ] **Providers**: Logo grid (Anthropic, OpenAI, Gemini, Grok, OpenRouter, Ollama)
- [ ] **Screenshot**: App screenshot or animated GIF showing a conversation
- [ ] **Footer**: GitHub, Discord, MIT License

### 3.4 Download Page
- [ ] Detect OS + arch via `navigator.userAgent` / `navigator.platform`
- [ ] Primary CTA: largest button for detected platform
- [ ] Secondary: table with all platform/arch combinations
- [ ] Links point to latest GitHub Release artifacts
- [ ] System requirements: macOS 12+, Windows 10+, Linux (glibc 2.31+)

### 3.5 Privacy Policy
- [ ] Create `/privacy` page with clear, plain-language privacy statement:
  - OpenWaggle runs entirely on the user's machine — no telemetry, no data collection, no analytics
  - API keys and OAuth tokens are stored locally, encrypted via OS keychain (`safeStorage`)
  - Conversations are stored as local JSON files — never uploaded anywhere
  - LLM API calls go directly from the user's machine to the provider — OpenWaggle has no proxy server
  - No accounts, no sign-up, no tracking
  - Open source — users can verify all of the above in the code
- [ ] Link to privacy policy from: website footer, About dialog, GitHub README

### 3.6 Design Direction
- Dark theme (`#141619` background, matching the app)
- Existing branding from `build/branding/` (logo mark + lockup SVGs)
- Clean, minimal, developer-focused — not marketing-heavy
- Responsive but optimized for desktop visitors

---

## Phase 4: Documentation

### 4.1 Location
Within the Astro website repo. Use Astro content collections with MDX (or Starlight theme for structured docs).

### 4.2 Pages
- [ ] **Getting Started**: Download → Install → Open project → Configure provider → First conversation
- [ ] **Provider Setup** (one page per provider):
  - Anthropic: console.anthropic.com API key
  - OpenAI: platform.openai.com
  - Google Gemini: aistudio.google.com
  - Grok: x.ai
  - OpenRouter: openrouter.ai
  - Ollama: local install + model pull + base URL config
- [ ] **Features**: Agent tools, terminal, git, orchestration, quality presets, skills, voice input, attachments
- [ ] **Configuration**: Settings overview, execution modes, keyboard shortcuts

### 4.3 In-App Help
- [ ] Add Help menu item in `src/main/index.ts` that opens `https://openwaggle.ai/docs` in default browser

---

## Phase 5: Community & Distribution

### 5.1 Community
- [ ] **Discord server**: channels `#general`, `#support`, `#feature-requests`, `#development`, `#show-and-tell`
- [ ] **GitHub Discussions**: Enable on repo (Q&A, Feature Requests, Show and Tell categories)
- [ ] **GitHub Issues**: Bugs only (template routes feature requests to Discussions)

### 5.2 Distribution Channels (Post-Launch)
| Channel | Priority | Notes |
|---------|----------|-------|
| GitHub Releases | P0 | Launch day |
| Website download page | P0 | Launch day |
| Homebrew Cask | P1 | `brew install --cask openwaggle` — create `openwaggle/homebrew-tap` |
| AUR | P3 | If Linux adoption grows |
| Windows winget | P3 | If Windows adoption grows |

---

## Execution Order & Dependencies

```
                     ┌─ 1.1 Repo docs (README, LICENSE, etc.)
                     ├─ 1.2 Code signing prep (entitlements, config)
Phase 1 (parallel) ─┤─ 1.3 Auto-update integration
                     ├─ 1.4 In-app feedback system
                     ├─ 1.5 First-run UX polish
                     └─ 1.6 UX hardening
                              │
                              ▼
Phase 2 ─────────── CI/CD workflows
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
Phase 3    Website     Phase 4 Docs     Phase 5 Community
(parallel after Phase 2)
```

**Can start immediately** (no external deps):
- Phase 1.1 (all repo docs)
- Phase 1.3 (auto-updater code)
- Phase 1.4 (in-app feedback system)
- Phase 1.5 (first-run UX polish)
- Phase 1.6 (UX hardening)
- Phase 2.1 (CI workflow — no signing needed)
- Phase 5 (Discord, GitHub Discussions)

**Blocked on external actions**:
- Apple Developer enrollment (~48h) → Phase 1.2 completion → signed release builds
- Domain registration (`openwaggle.ai`) → Phase 3
- GitHub org creation (`openwaggle`) → Phase 1.1, 2.2

---

## Verification

- [ ] `pnpm build:mac` produces signed, notarized DMG (after Apple enrollment)
- [ ] `pnpm build:win` produces NSIS installer
- [ ] `pnpm build:linux` produces AppImage
- [ ] Tag push triggers release workflow, all 3 platform artifacts attached to draft release
- [ ] Auto-updater detects new version after publishing a release
- [ ] Website loads at `openwaggle.ai`, platform detection works, download links resolve
- [ ] Docs pages render correctly with accurate setup instructions
- [ ] Fresh install on each platform: download → install → configure provider → run first conversation
- [ ] First-run with no API key shows clear guidance to configure a provider
- [ ] "Send Feedback" from Help menu creates a GitHub issue with metadata + logs
- [ ] "Report this issue" from error display pre-fills error context in feedback form
- [ ] Feedback fallback works when `gh` CLI is not installed (opens browser)
- [ ] App menu is functional on all platforms (File, Edit, View, Help)
- [ ] About dialog shows correct version
- [ ] Sending a message while offline shows "No internet connection" (cloud providers only, Ollama still works)
- [ ] "Export conversation" produces a readable Markdown file
- [ ] Rate limit error shows provider name and suggests alternatives
- [ ] Keyboard shortcuts panel lists all available shortcuts and stays in sync
- [ ] No "Coming soon" placeholder content visible in settings
- [ ] Privacy policy page loads at `/privacy` with accurate, plain-language content

---

## Deferred to Future Versions

Items identified during v1 audit that aren't blocking launch but should be addressed post-ship:

### v1.1 (First Update)
- [ ] **Crash reporting** — catch unhandled main-process exceptions and write crash dumps to the log file via the existing `FileWriter` logger. On next launch, detect if previous session crashed (check for crash marker file) and prompt user: "OpenWaggle crashed last session. Send a bug report?" which pre-fills the feedback dialog with the crash log. No external service needed — relies on the existing feedback system to surface crashes.
- [ ] **Anonymous usage analytics** — opt-in telemetry to understand feature adoption. No PII, no conversation content. Just events like "conversation started", "provider used", "tool called". Helps prioritize roadmap. Must be off by default with clear opt-in toggle in Settings.
- [ ] **Conversation search** — search across past conversations by keyword. Conversations are JSON files — index titles + message text for basic full-text search.
- [ ] **Conversation data portability** — bulk export/import of all conversations (zip of Markdown or JSON). Useful for machine migration or backup.

### v1.2+
- [ ] **Accessibility audit** — proper `aria-label` and `role` attributes on all interactive elements, full keyboard navigation, screen reader compatibility. Current state: partial (34 aria attributes found, but incomplete coverage).
- [ ] **Deep links / protocol handler** — register `openwaggle://` protocol for opening conversations or projects from external links (browser, terminal, other apps).
- [ ] **Uninstall cleanup** — prompt to delete local data (conversations, settings, logs) when uninstalling. On Windows, AppData folder persists after uninstall by default.
- [ ] **Multi-window behavior** — define and document what happens when user opens multiple windows. Do conversations sync? Are they isolated? Currently undefined.
- [ ] **Windows code signing** — purchase EV certificate to eliminate SmartScreen warning. Deferred because workaround exists (right-click → Properties → Unblock) and cost is high.
