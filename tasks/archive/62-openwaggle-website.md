# Spec: OpenWaggle Website (openwaggle.ai)

**Status:** Done
**Branch:** `feat/openwaggle-website`
**Domain:** openwaggle.ai
**Framework:** Astro 5 + Tailwind v4
**Deployment:** Cloudflare Pages
**Design:** Pencil mockup in `codex-clone.pen` → frame "OpenWaggle Landing Page"

---

## Phase 0: Project Scaffolding & Monorepo Integration

**Goal:** A buildable Astro project inside `website/` that coexists with the Electron app.

- [ ] Create `website/` directory at repo root
- [ ] Scaffold Astro project: `pnpm create astro@latest website --template minimal --typescript strict --install`
- [ ] Add `@astrojs/cloudflare` adapter
- [ ] Add `@astrojs/mdx` integration for docs pages
- [ ] Add `@astrojs/sitemap` integration for SEO
- [ ] Update `pnpm-workspace.yaml` to include `website` in the packages list
- [ ] Add workspace scripts to root `package.json`:
  ```json
  "website:dev": "pnpm --filter website dev",
  "website:build": "pnpm --filter website build",
  "website:preview": "pnpm --filter website preview"
  ```
- [ ] Configure `website/astro.config.mjs`:
  ```js
  import { defineConfig } from 'astro/config';
  import cloudflare from '@astrojs/cloudflare';
  import mdx from '@astrojs/mdx';
  import sitemap from '@astrojs/sitemap';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    site: 'https://openwaggle.ai',
    output: 'static',
    adapter: cloudflare(),
    integrations: [mdx(), sitemap()],
    vite: {
      plugins: [tailwindcss()],
    },
  });
  ```
- [ ] Add `website/tsconfig.json` extending Astro's strict preset
- [ ] Add Tailwind v4 + `@tailwindcss/vite` as devDependencies
- [ ] Add `lucide-astro` for icons
- [ ] Verify `pnpm install` from root succeeds and `pnpm website:dev` starts

**Key files created:**
- `website/package.json`
- `website/astro.config.mjs`
- `website/tsconfig.json`
- `website/src/pages/index.astro` (placeholder)

---

## Phase 1: Design System & Shared Tokens

**Goal:** Tailwind theme and reusable component primitives matching the app aesthetic.

- [ ] Create `website/src/styles/global.css` with Tailwind v4 `@theme` block. Port tokens from `src/renderer/src/styles/globals.css`:
  ```css
  @import "tailwindcss";

  @theme {
    /* Surfaces */
    --color-bg: #141619;
    --color-bg-secondary: #1a1d22;
    --color-bg-tertiary: #1f232a;
    --color-bg-hover: #262b33;

    /* Borders */
    --color-border: #1e2229;
    --color-border-light: #2a3240;

    /* Text hierarchy */
    --color-text-primary: #e7e9ee;
    --color-text-secondary: #c9cdd6;
    --color-text-tertiary: #9098a8;
    --color-text-muted: #666f7d;

    /* Brand + semantic */
    --color-accent: #f5a623;
    --color-accent-dim: #b87410;
    --color-success: #4caf72;
    --color-error: #ef4444;
    --color-info: #61a8ff;

    /* Agent palette */
    --color-agent-blue: #4c8cf5;
    --color-agent-amber: #f5a623;
    --color-agent-emerald: #34d399;
    --color-agent-violet: #a78bfa;

    /* Typography */
    --font-display: "Space Grotesk", "Sora", sans-serif;
    --font-sans: Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
  }
  ```
- [ ] Self-host fonts via `@fontsource/space-grotesk` and `@fontsource/inter`
- [ ] Create `website/src/layouts/BaseLayout.astro` — HTML shell with:
  - `<html lang="en" class="dark">` (dark mode only)
  - Meta viewport, charset, font preloads
  - Global CSS import
  - `<slot />` for page content
- [ ] Create `website/src/layouts/DocsLayout.astro` — extends BaseLayout, adds sidebar + TOC
- [ ] Create shared Astro components in `website/src/components/`:
  - `Header.astro` — sticky nav with logo mark (`build/branding/openwaggle-logo-mark.svg` at 28px) + "OpenWaggle" wordmark (Space Grotesk 18px/650) + nav links (Docs, Download, GitHub)
  - `Footer.astro` — logo lockup + tagline "The coding harness that lets your agents waggle." + 3 nav columns (Product, Docs, Community) + copyright + "★ Star on GitHub ↗" + "☕ Buy me a coffee ↗"
  - `Button.astro` — primary (amber gradient `from-accent to-accent-dim`), secondary (ghost/outline)
  - `Badge.astro` — pill badge component
  - `Card.astro` — dark card with border, hover state
  - `SectionHeader.astro` — amber label + headline + optional subtext

---

## Phase 2: Asset Pipeline

**Goal:** All brand assets, fonts, favicons, and OG images ready.

- [ ] Copy brand SVGs into `website/public/`:
  - `website/public/logo-mark.svg` ← `build/branding/openwaggle-logo-mark.svg`
  - `website/public/logo-lockup.svg` ← `build/branding/openwaggle-logo-lockup.svg`
- [ ] Copy favicon files into `website/public/`:
  - `favicon.ico`, `favicon-16.png`, `favicon-32.png` ← `src/renderer/`
  - Create `favicon.svg` from the mark SVG
  - Create `apple-touch-icon.png` (180px) from `build/branding/mark/openwaggle-mark-256.png`
- [ ] Create `website/public/og-image.png` (1200x630) — brand lockup on dark background with tagline
- [ ] Create product screenshot placeholders in `website/public/screenshots/`:
  - `hero-screenshot.png` — main app with Waggle Mode active
  - `feature-coding-agent.png` — chat + tool calls view
  - `feature-git-workflow.png` — git integration / diff panel
  - `feature-extensible.png` — skills & MCP servers panel
- [ ] Add `website/public/site.webmanifest`
- [ ] Add TanStack AI logo for trust bar (small icon, links to tanstack.com)

---

## Phase 3: Landing Page — All Sections

**Goal:** All 8 landing page sections from the approved Pencil design.

### 3a. Hero Section (`website/src/components/landing/Hero.astro`)
- [ ] Warm amber mesh gradient glow as CSS `radial-gradient` background
- [ ] Logo mark at ~140px (`/logo-mark.svg`)
- [ ] Pill badge: "Open Source Desktop Coding Agent" (green dot + text)
- [ ] Headline: `The coding harness that` (white) + `lets your agents waggle.` (amber)
  - Space Grotesk, 48-56px, bold
- [ ] Subheadline: "In nature, bees don't solve problems alone — they perform a waggle dance to share what they've found. OpenWaggle works the same way: two AI agents collaborate in structured turns until they converge on solutions no single model would reach."
  - Inter, 18px, muted text, max-width ~620px
- [ ] Primary CTA: "Download for macOS" — amber gradient button
- [ ] Secondary CTA: "View Documentation" — ghost button with border
- [ ] Product screenshot placeholder (rounded corners, subtle border)

### 3b. Trust Bar (`website/src/components/landing/TrustBar.astro`)
- [ ] "Works with 6 providers" — Inter 13px, secondary text
- [ ] Provider names row: Anthropic, OpenAI, Gemini, Grok, OpenRouter, Ollama (muted, evenly spaced)
- [ ] "Powered by TanStack AI ↗" — JetBrains Mono 11px, muted, with TanStack logo icon, links to tanstack.com
- [ ] Responsive: wraps on mobile

### 3c. How Waggle Mode Works (`website/src/components/landing/HowWaggleWorks.astro`)
- [ ] Amber section label "HOW WAGGLE MODE WORKS"
- [ ] Heading: "Two models collaborate like bees in a hive"
- [ ] Subtext with waggle dance metaphor
- [ ] 3 step cards in responsive row:
  1. **Configure your team** (amber `#f5a623` number badge) — "Pick two models from different providers. Assign roles, strengths, and collaboration rules. Save as a reusable preset."
  2. **Agents collaborate** (blue `#61a8ff` number badge) — "They take structured turns — reading files, running commands, challenging each other's assumptions. You watch in real time."
  3. **Consensus reached** (green `#4caf72` number badge) — "When agents converge on a solution, a synthesis step combines their findings into a clear recommendation with agreed points and open questions."
- [ ] Warm glow background treatment (subtle, matches hero)

### 3d. Core Features (`website/src/components/landing/CoreFeatures.astro`)
- [ ] Amber section label "CORE FEATURES" + heading "Everything a coding agent needs"
- [ ] 3 alternating text + screenshot rows:
  1. **Full coding agent** (text left, screenshot right) — "Read, write, and edit files. Run shell commands. Browse the web. Ask clarifying questions. All with approval-based execution — you stay in control of every destructive operation."
  2. **Git-native workflow** (screenshot left, text right) — "Live diff stats in the header. Branch management from the picker. Stage, commit, and review changes in a side-by-side diff panel — all without leaving the conversation."
  3. **Infinitely extensible** (text left, screenshot right) — "Custom skills add specialized knowledge to the agent. MCP servers connect external tools — from Playwright browser automation to Chrome DevTools. Per-project AGENTS.md files scope instructions to specific paths."
- [ ] Screenshot placeholders with rounded corners and subtle border
- [ ] Responsive: stacks vertically on mobile (text always first)

### 3e. Secondary Features Grid (`website/src/components/landing/SecondaryFeatures.astro`)
- [ ] Amber section label "BUILT FOR DEVELOPERS" + heading "Every detail considered"
- [ ] 2×3 responsive grid (1 col mobile, 2 col tablet, 3 col desktop):
  1. **Local-first privacy** (Shield icon, amber) — "Conversations, API keys, and voice data stay on your machine. No telemetry. No cloud sync."
  2. **Voice input** (Mic icon, blue) — "Local Whisper transcription. Speak your instructions — no audio leaves your machine."
  3. **Plan mode** (ListChecks icon, green) — "The agent outlines its approach before executing. Review, revise, and approve the plan interactively."
  4. **Rich attachments** (Paperclip icon, violet) — "Drop text files, PDFs, and images into the conversation. Content is extracted automatically with OCR for images."
  5. **Built-in terminal** (Terminal icon, emerald) — "Full PTY terminal emulation with xterm.js. Toggle with a shortcut — run commands without leaving the app."
  6. **Execution modes** (Lock icon, amber) — "Default mode requires approval for writes and shell commands. Full access mode executes immediately. You choose the trust level."

### 3f. Final CTA (`website/src/components/landing/FinalCTA.astro`)
- [ ] "Ready to waggle?" — Space Grotesk 48px
- [ ] Warm mesh gradient glow background
- [ ] Download + Docs buttons (same style as hero)
- [ ] "Free and open source · macOS, Windows, Linux"

### 3g. Assemble (`website/src/pages/index.astro`)
- [ ] Import all sections, compose in order within BaseLayout

---

## Phase 4: Background Animations

**Goal:** Subtle decorative canvas animations behind hero and CTA sections.

- [ ] Create `website/src/components/HoneycombBackground.astro`:
  - Vanilla JS `<script>` (no framework needed — Astro island with `client:visible`)
  - Canvas renders:
    1. Faint honeycomb wireframe grid (hexagons) with slow opacity oscillation (breathing, 4-6s cycle)
    2. Small warm-toned particle dots (`#f5a623` at 10-20% opacity) drifting gently upward
  - Positioned `absolute`, `inset-0`, `z-0` (content at `z-10` relative)
  - `pointer-events: none`
  - Respects `prefers-reduced-motion`: disables animation, shows static state
  - Lazy: starts only when section enters viewport (IntersectionObserver)
  - Canvas DPR-aware for crisp rendering
  - Performance: `requestAnimationFrame` throttled to 30fps, pauses when tab hidden
- [ ] CSS radial-gradient glow as fallback/base layer (works without JS):
  ```css
  .hero-glow {
    background: radial-gradient(
      ellipse 70% 60% at 50% 15%,
      rgba(245, 166, 35, 0.15) 0%,
      rgba(184, 116, 16, 0.06) 35%,
      transparent 70%
    );
  }
  ```
- [ ] Apply to Hero, HowWaggleWorks, and FinalCTA sections
- [ ] **Important:** Background only — no content shifts, no layout impact

---

## Phase 5: Documentation Site

**Goal:** Full docs with content collections, sidebar navigation, and search.

### 5a. Content Collections
- [ ] Configure `website/src/content.config.ts` with Astro 5 content layer:
  ```ts
  import { defineCollection, z } from 'astro:content';
  import { glob } from 'astro/loaders';

  const docs = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      order: z.number().default(999),
      section: z.string(),
    }),
  });

  export const collections = { docs };
  ```

### 5b. Content Migration
- [ ] Create `website/src/content/docs/` with this structure:
  ```
  getting-started/
    installation.md          ← from docs/user-guide/getting-started.md
    first-run.md             ← split from getting-started.md
    interface-overview.md    ← new (TODO placeholder)
    keyboard-shortcuts.md    ← new (TODO placeholder)
  using-openwaggle/
    chat-and-tools.md        ← from docs/user-guide/chat-and-tools.md
    waggle-mode.md           ← from docs/user-guide/waggle-mode.md
    attachments-voice.md     ← new (split from chat-and-tools)
    plan-mode.md             ← new (TODO placeholder)
  providers/
    overview.md              ← from docs/user-guide/providers.md (intro)
    anthropic.md             ← split from providers.md
    openai.md                ← split from providers.md
    google-gemini.md         ← split from providers.md
    grok.md                  ← split from providers.md
    openrouter.md            ← split from providers.md
    ollama.md                ← split from providers.md
  developer-workflow/
    git-integration.md       ← from docs/user-guide/git-integration.md
    built-in-terminal.md     ← new (TODO placeholder)
    execution-modes.md       ← new (TODO placeholder)
  extending/
    skills-system.md         ← from docs/user-guide/skills.md
    mcp-servers.md           ← from docs/user-guide/mcp-servers.md
    agents-md.md             ← new (TODO placeholder)
    creating-custom-skills.md ← new (TODO placeholder)
  configuration/
    app-settings.md          ← from docs/user-guide/configuration.md
    per-project-config.md    ← split from configuration.md
    quality-presets.md        ← new (TODO placeholder)
    security-privacy.md      ← new (TODO placeholder)
  developer-guide/
    architecture.md          ← from docs/user-guide/developer-guide.md
    contributing.md          ← new (TODO placeholder)
    building-from-source.md  ← split from developer-guide.md
  ```
- [ ] Add frontmatter to each file: `title`, `description`, `order`, `section`

### 5c. Sidebar Navigation
- [ ] Create `website/src/data/docs-nav.ts` — static nav structure
- [ ] Create `website/src/components/docs/Sidebar.astro`:
  - Collapsible section groups
  - Active page highlighting via `Astro.url.pathname`
  - Mobile: hamburger toggle (small client-side JS)
  - Sticky positioning

### 5d. Docs Page Template
- [ ] Create `website/src/pages/docs/[...slug].astro` — dynamic route rendering content collection entries
- [ ] Create `website/src/components/docs/TableOfContents.astro` — auto-generated from headings, sticky right sidebar on desktop
- [ ] Create `website/src/components/docs/PrevNext.astro` — previous/next navigation

### 5e. Prose Styling
- [ ] Create `website/src/styles/prose.css` — port from `src/renderer/src/styles/globals.css`:
  - Code blocks with Shiki syntax highlighting (Astro built-in)
  - Tables, blockquotes, lists
  - Callout/admonition blocks (tip, warning, note)
  - Responsive images

### 5f. Search (Pagefind)
- [ ] Add `@pagefind/default-ui` as devDependency
- [ ] Add Pagefind build step: `"postbuild": "pagefind --site dist"`
- [ ] Create `website/src/components/docs/Search.astro` — wraps Pagefind UI
- [ ] Search trigger in docs header (magnifying glass, Cmd+K shortcut)
- [ ] Style Pagefind UI to match dark theme

---

## Phase 6: SEO & Meta

**Goal:** Comprehensive SEO for landing page and all docs pages.

- [ ] Create `website/src/components/SEO.astro`:
  - `<title>`, `<meta name="description">`, `<link rel="canonical">`
  - Open Graph tags (og:title, og:description, og:image, og:site_name)
  - Twitter Card tags (summary_large_image)
  - Favicon links (ico, png 16/32, apple-touch-icon, webmanifest)
- [ ] JSON-LD structured data:
  - `SoftwareApplication` on landing page
  - `BreadcrumbList` on docs pages
  - `WebSite` with `SearchAction` for Pagefind
- [ ] `website/public/robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://openwaggle.ai/sitemap-index.xml
  ```
- [ ] Verify `@astrojs/sitemap` generates sitemap at build
- [ ] `<meta name="theme-color" content="#141619" />`

---

## Phase 7: Deployment & CI/CD

**Goal:** Automated deployment to Cloudflare Pages on push to main.

- [ ] Create `.github/workflows/deploy-website.yml`:
  - Trigger on push to `main` (paths: `website/**`, `docs/user-guide/**`)
  - Trigger on PR (paths: `website/**`) for build check only
  - Steps: checkout → pnpm install → build → deploy via `cloudflare/wrangler-action`
  - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- [ ] Add `website/public/_headers` for Cloudflare:
  ```
  /*
    X-Frame-Options: DENY
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin

  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```
- [ ] Add `website/public/_redirects`:
  - `/docs` → `/docs/getting-started/installation`
- [ ] Manual one-time: create Cloudflare Pages project, add `openwaggle.ai` custom domain, configure DNS

---

## Phase 8: Polish & Quality

**Goal:** Responsive, performant, accessible.

- [ ] Responsive testing: 320px (mobile), 768px (tablet), 1024px (laptop), 1440px (desktop)
- [ ] Lighthouse target: 95+ on all categories
- [ ] All images: `alt` attributes, `loading="lazy"` for below-fold
- [ ] `prefers-reduced-motion` disables all animations
- [ ] Skip-to-content link for screen readers
- [ ] Test all external links (GitHub, TanStack, Buy Me a Coffee)
- [ ] Pagefind search works across all docs
- [ ] Docs sidebar mobile hamburger menu
- [ ] OG image renders correctly
- [ ] Cross-browser: Chrome, Firefox, Safari

---

## Dependency Summary

| Package | Purpose |
|---------|---------|
| `astro` | Framework |
| `@astrojs/cloudflare` | Deployment adapter |
| `@astrojs/mdx` | MDX support for docs |
| `@astrojs/sitemap` | Auto sitemap |
| `tailwindcss` + `@tailwindcss/vite` | Styling (dev) |
| `@fontsource/space-grotesk` | Display font (self-hosted) |
| `@fontsource/inter` | Body font (self-hosted) |
| `lucide-astro` | Icons |
| `@pagefind/default-ui` | Docs search (dev) |

---

## File Tree (final state)

```
website/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── public/
│   ├── _headers
│   ├── _redirects
│   ├── favicon.ico / favicon-16.png / favicon-32.png / favicon.svg
│   ├── apple-touch-icon.png
│   ├── logo-mark.svg
│   ├── logo-lockup.svg
│   ├── og-image.png
│   ├── robots.txt
│   ├── site.webmanifest
│   └── screenshots/
│       ├── hero-screenshot.png
│       ├── feature-coding-agent.png
│       ├── feature-git-workflow.png
│       └── feature-extensible.png
├── src/
│   ├── content.config.ts
│   ├── content/docs/
│   │   ├── getting-started/
│   │   ├── using-openwaggle/
│   │   ├── providers/
│   │   ├── developer-workflow/
│   │   ├── extending/
│   │   ├── configuration/
│   │   └── developer-guide/
│   ├── data/
│   │   └── docs-nav.ts
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── DocsLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   └── docs/[...slug].astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── Button.astro
│   │   ├── Badge.astro
│   │   ├── Card.astro
│   │   ├── SectionHeader.astro
│   │   ├── SEO.astro
│   │   ├── HoneycombBackground.astro
│   │   ├── landing/
│   │   │   ├── Hero.astro
│   │   │   ├── TrustBar.astro
│   │   │   ├── HowWaggleWorks.astro
│   │   │   ├── CoreFeatures.astro
│   │   │   ├── SecondaryFeatures.astro
│   │   │   └── FinalCTA.astro
│   │   └── docs/
│   │       ├── Sidebar.astro
│   │       ├── TableOfContents.astro
│   │       ├── PrevNext.astro
│   │       └── Search.astro
│   └── styles/
│       ├── global.css
│       └── prose.css
```

---

## External Links Reference

| Link | Target |
|------|--------|
| Download | GitHub Releases (initially) |
| GitHub | https://github.com/OpenWaggle/OpenWaggle |
| TanStack AI | https://tanstack.com |
| Buy me a coffee | https://buymeacoffee.com/openwaggle (TBD) |
| Star on GitHub | https://github.com/OpenWaggle/OpenWaggle |

---

## Implementation Order

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 0 | Scaffolding & monorepo | None |
| 1 | Design system & tokens | Phase 0 |
| 2 | Asset pipeline | Phase 0 |
| 3 | Landing page sections | Phase 1, 2 |
| 4 | Background animations | Phase 3 |
| 5 | Documentation site | Phase 1, 2 |
| 6 | SEO & meta | Phase 3, 5 |
| 7 | Deployment & CI/CD | Phase 3 |
| 8 | Polish & QA | All |

Phases 3 and 5 can be parallelized (landing page and docs are independent after the design system is ready).
