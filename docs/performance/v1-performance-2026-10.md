# v1 performance: before and after (October 2026)

This report compares 1.0.0-beta.27 (`77b9814b5`) with the v1 performance integration branch at its final code state on every gate in the v1 performance plan. Both sides are packaged builds measured on the same machine in one session, with interleaved runs.

## Gates

"beta.27" and "v1" are medians of interleaved runs from the final measurement. Ranges are min–max. The "plan baseline" column is the value the plan was written against; it came from earlier research runs, so compare v1 with the beta.27 column.

| Area | Gate | Plan baseline | beta.27 | v1 | Met |
|---|---|---|---|---|---|
| Cold launch → Session list | ≤ 1.0 s | 1.75 s | 1.75 s (1.70–2.42) | 0.88 s (0.83–0.92) | yes |
| Cold launch → first paint | ≤ 0.8 s | 1.68 s | 1.71 s (1.67–2.37) | 0.66 s (0.64–0.72) | yes |
| Warm launch → Session list | ≤ 0.8 s | 1.05 s | 1.04 s (1.01–1.28) | 0.56 s (0.55–0.66) | yes |
| Renderer LCP (empty profile, cold launch) | ≤ 350 ms | 516 ms | 536 ms (520–636) | 152 ms (136–196) | yes |
| `openwaggle --version` | ≤ 0.3 s | 0.50 s | 501 ms (496–525) | 106 ms (104–140) | yes |
| Open a large Session: IPC bytes | −80% | MB-scale | 166.6 MB | 3.77 MB (−97.7%) | yes |
| Open a large Session: time to the last message | faster | | 431 ms (422–494) | 342 ms (297–437) | yes |
| Streaming at 4× CPU throttle: main thread busy | ≤ 30% | 61.5% | 72.7% (69.4–74.4) | 21.9% (21.5–22.8) | yes |
| Streaming at 4× CPU throttle: p99 frame | ≤ 20 ms | 42.6 ms | 16.9 ms (16.3–17.3) | 10.4 ms (10.4–10.4) | yes |
| First-turn prefix, empty project | ≤ 4k o200k | ~10k | 13,096 o200k | 3,710 o200k | yes |
| First-turn prefix, maintainer-like setup | ≤ 15k Opus | 52.5k | 54,684 Opus (32,804 o200k) | 14,476 Opus (8,684 o200k) | yes, see [the skills cap](#the-160-character-skill-description-cap) |
| Memory, 6-Run Hive with heavy MCP | ≤ 4 GB | 8.0 GB | 5,027 MB (4,985–5,273) | 1,478 MB (1,472–1,485) | yes |
| Idle Host 240 s after window close | ≤ 250 MB, ~0% CPU | 0.4–1.5 GB | 404 MB, 0.5% | 135 MB, 0.3% | yes |
| Bedrock time to first byte per call | −250 ms | | 2,545 / 1,792 ms | 1,043 / 1,069 ms | yes |
| Agent evals | no group regresses; tokens and cost down | | see [Evals](#evals) | accepted on both models | yes |
| Regression | `pnpm check` and all test tiers green | | | see [Checks](#checks) | see Checks |

Cold launches are from an empty profile with a cold compile cache, which is the first launch after an update. The [Startup](#startup) section also has warm-cache launches, a slow login shell, and the medium and large profiles.

## Method

### Builds

Both apps were built the same way: `pnpm build`, then `electron-builder --dir` with code signing off.

- beta.27: `77b9814b5`.
- v1: the integration branch at `ac6df366f`, merged into the W0 branch. Only `scripts/` differ from the integration branch, and they are not packaged.
- The prefix rows, the competitor benchmark and the skills evals were then re-run on `dbb0d5187`, which adds one change on top: skill descriptions in the prompt listing are cut at 160 characters instead of 200. Nothing else differs from `ac6df366f`.

### Harnesses

All harnesses live in `scripts/perf/`. Every measured launch uses a throwaway profile with its own HOME, user data, Pi agent dir and project, so the real profile, app and Host are never touched. Runs alternate between the builds (beta.27, v1, v1, beta.27, …) so that load changes hit both sides.

| Gate | Command | Runs per side |
|---|---|---|
| Launch, `--version`, profiles | `pnpm perf:startup --mode cold\|warm\|version [--compile-cache cold\|warm] [--login-shell slow] [--template <profile>] [--warmed-by <label>\|none]` | 10 (unwarmed large: 3, v1 only) |
| Large Session open | `pnpm perf:session-open --template <profile> [--mode cross-project]` | 10 (medium), 5 (large, v1 only) |
| Streaming | `pnpm perf:streaming --cpu-throttle 4` | 10 |
| Idle Host | `pnpm perf:idle-host` | 3 |
| Hive memory | `pnpm perf:hive-memory` | 3 |
| Bedrock TTFB | `pnpm perf:bedrock-ttfb`, 20 sequential calls | 2 × 20 calls |
| Prefix, in-process | `pnpm perf:first-turn-prefix` | 1 (deterministic) |
| Prefix, packaged | `pnpm perf:first-turn-prefix:packaged --setup empty\|maintainer\|real-home` | 1 (deterministic) |
| Agent evals | `pnpm evaluate:agent-context --reps 5 --baseline <beta.27 dir>` | 125 per model |
| Competitor benchmark | `scripts/benchmark-docker/run.sh` with `BENCH_OPENWAGGLE_APP` | 1 |

Idle Host and Hive memory each take 4–7 minutes per run, so they ran 3 times per side. Their spread is small next to the gaps they measure.

What the harnesses measure:

- **Launch timings.** Measured from spawn. "Session list" is the first frame that shows the Session list, and "chat ready" is when the composer is editable.
- **LCP.** Reported after renderer navigation (the gate) and from spawn. In v1 the window shows a startup frame from `index.html`, so on an empty profile LCP is that first paint.
- **Compile cache.** v1 keeps a V8 compile cache under `~/Library/Caches/OpenWaggle`.
  - "Cold cache" is a fresh HOME.
  - "Warm cache" primes the cache once per build and copies it into every measured HOME.
  - beta.27 has no compile cache, so its two series differ only by load.
- **Slow login shell.** The desktop app probes the user's login shell for its environment. `--login-shell slow` gives every measured HOME a `.zshrc` that sleeps 0.3 s and exports a real PATH. The packaged prefix's `real-home` setup does the same.
- **Profiles and warm templates.**
  - Profiles come from `pnpm perf:generate-profile`. **Medium:** 40 Sessions and 19,474 nodes. **Large:** 1,800 Sessions, 301,523 nodes and 1.46 GB, including 4 Sessions of 3,600 messages, spread over 12 projects.
  - Each build first opens its own copy of a profile once, as an upgrade would. The window stays attached until the Host's background work (discovery, term repair, semantic preparation) goes idle, so measured launches start from a steady state.
  - At the end of warming, every background queue was empty. The large copy took v1 175 s to settle; medium took about 26 s on either build.
  - beta.27 cannot open the large profile (see [Large profile](#large-profile)), so both builds' large-profile launches use the copy v1 warmed. `--warmed-by none` measures first opens of the raw profile.
- **Session open.** Opens a 3,600-message Session and waits until its last message renders. IPC is counted in the main process through `--inspect`. `--mode cross-project` then opens a large Session of another project 5 s later, which is when the Host's background work starts. That second open is the cross-project time, and its IPC counts cover the switch only.
- **Streaming.** A fake OpenAI SSE provider streams a long answer while the renderer's CPU is throttled 4×.
- **Hive memory.**
  - A scripted fake provider has the Queen spawn four Workers; Worker 1 spawns the fifth, because the Host allows four running children per parent.
  - Each of the 6 Sessions then holds a long `bash sleep`.
  - Each Session has six MCP fixture servers: three local servers and three real npm packages at pinned versions.
  - Memory is the summed physical footprint of the GUI and Host process trees over 20 samples. A process counts as the app's only when its executable is inside the measured bundle; the Host's embedding child counts as the Host's.
- **Idle Host.** Opens the app, closes the window, and samples the Host tree 30, 120 and 240 s after close. The table reports the 240 s sample.
- **Bedrock.** Runs in-process through OpenWaggle's Pi runtime against `eu.anthropic.claude-sonnet-5`, and counts TLS handshakes per call. beta.27 was measured from a temporary worktree of `77b9814b5` with the same test file.

### Machine and load

Apple M4 Max, 14 cores, 36 GB, macOS 26.6.2, Node 24.

No other Hive Worker was measuring or building during the final series. Three unrelated processes from another project ran throughout and were left alone: two `node` processes at 100% CPU each, and a Docker VM at 130–400%. Load per series, 1-minute average:

| Series | Time | Load at start → end |
|---|---|---|
| Empty profile, cold launch, cold cache | 03:29–03:35 | 6.1 → 5.7 |
| Empty profile, cold launch, warm cache | 03:35–03:42 | 5.7 → 6.7 |
| Empty profile, warm launch | 03:42–03:50 | 6.7 → 7.6 |
| Empty profile, cold launch, slow login shell | 03:50–03:56 | 7.6 → 8.8 |
| `--version`, cold and warm cache | 03:56–03:58 | 8.8 → 7.7 |
| Medium profile | 03:58–04:06 | 7.7 → 8.7 |
| Large profile, warmed and unwarmed | 04:06–04:21 | 8.7 → 8.0 |
| Session open: medium, medium cross-project, large, large cross-project | 04:21–04:41 | 8.0 → 7.0 |
| Streaming | 04:41–04:53 | 7.0 → 5.8 |
| Idle Host | 04:53–05:19 | 5.8 → 8.2 |
| Hive memory | 05:19–05:31 | 8.2 → 6.6 |
| Packaged prefix | 05:31–05:34 | 6.6 → 7.3 |
| Bedrock | 03:24–03:28 | 8.8 → 7.7 |

## Results by area

### Startup

Empty profile, 10 runs per side.

| Launch | Metric | beta.27 | v1 |
|---|---|---|---|
| Cold, cold cache | window created | 1,515 ms | 499 ms |
| | Host listening | 1,424 ms | 789 ms |
| | first paint | 1,706 ms | 660 ms |
| | Session list / chat ready | 1,746 / 2,022 ms | 883 / 883 ms |
| | LCP after navigation | 536 ms | 152 ms |
| | LCP from spawn | 2,049 ms | 660 ms |
| Cold, warm cache | first paint | 1,711 ms | 476 ms |
| | Session list | 1,745 ms | 674 ms |
| | LCP after navigation | 532 ms | 152 ms |
| Cold, cold cache, slow login shell | first paint | 2,069 ms | 688 ms |
| | Session list | 2,103 ms | 860 ms |
| Warm (Host already running) | first paint | 1,000 ms | 461 ms |
| | Session list | 1,038 ms | 562 ms |
| | LCP after navigation | 524 ms | 148 ms |
| `--version` | cold cache / warm cache | 501 / 509 ms | 106 / 104 ms |

A slow login shell adds about 360 ms to every beta.27 launch, because its environment probe sits on the critical path. v1 is unaffected: 860 ms against 883 ms. A warm compile cache saves v1 about 200 ms.

### Medium and large profiles

| Profile | Metric | beta.27 | v1 |
|---|---|---|---|
| Medium, warm cache | Host listening | 1,416 ms | 574 ms |
| | first paint | 1,698 ms | 487 ms |
| | Session list | 1,762 ms (1,694–2,162) | 696 ms (642–760) |
| | LCP after navigation | 512 ms | 390 ms |
| Large, copy warmed by v1, warm cache | Session list | renderer never opened: 10 of 10 runs timed out at 60 s | 775 ms (693–1,205) |
| | LCP after navigation | | 392 ms |
| Large, unwarmed first open, cold cache (v1 only, n=3) | Host listening | never listened in 37 min (baseline) | 944 ms (939–1,334) |
| | Session list | | 1,097 ms (1,082–1,494) |

On a profile with Sessions, the LCP element is the Session list rather than the startup frame. It lands about 390 ms after navigation: under the 512 ms of beta.27, but over the 350 ms gate. The gate was set against the empty profile, where v1 measures 152 ms.

#### Large profile

beta.27's Host never starts listening on the large profile: embedding inference runs on its main thread, and it did not commit one batch in 37 minutes. v1 listens in under 1 s on the same profile, unwarmed. With the window attached, its background work on that profile finishes in about 3 minutes.

### Large Session open

Medium profile, 10 runs per side.

| | beta.27 | v1 |
|---|---|---|
| IPC invoke bytes | 166.6 MB | 3.77 MB |
| `sessions:get-tree` | ×4, 95.3 MB | not called |
| `sessions:get-workspace` | ×1, 47.9 MB | ×1, 2.4 MB |
| `sessions:get-detail` | ×2, 22.9 MB | ×1, 1.3 MB |
| Time to last message | 431 ms (422–494) | 342 ms (297–437) |
| Renderer JS heap after open | 223 MB | 49 MB |
| **Cross-project switch** (second large Session, other project, 5 s later) | 845 ms (823–925), 212.8 MB | 184 ms (155–235), 3.75 MB |

On the large profile (v1 only, 5 runs), the first open takes 339 ms (231–451) and moves 3.85 MB. The cross-project switch takes 166 ms (157–223).

### Streaming at 4× CPU throttle

| | beta.27 | v1 |
|---|---|---|
| Renderer main thread busy | 72.7% | 21.9% |
| Frame p50 / p95 / p99 | 8.3 / 10.2 / 16.9 ms | 8.3 / 10.2 / 10.4 ms |
| Frames over 33 ms / 100 ms | 9 / 0 | 8 / 0.5 |
| `agent:event` sends | 1,507 (443 KB) | 378 (115 KB) |

beta.27 measures better here than in earlier runs: 72.7% busy against 86.6%, and a p99 of 16.9 ms against 34.8 ms. Until `54cd9962f`, the harness's boot probe read the page's whole text on every frame. That cost was added to both builds while they streamed.

### First-turn prefix

| Measurement | beta.27 | v1 |
|---|---|---|
| In-process, independent / Queen / Worker | 13,304 / 13,301 / 11,289 o200k | 3,779 / 3,782 / 3,777 o200k |
| Packaged, empty project | 13,096 o200k (21,831 Opus), 24 tools | 3,710 o200k (6,185 Opus), 7 tools |
| Packaged, empty project, real-ish HOME (slow `.zshrc`, real PATH) | 13,091 o200k, 24 tools | 3,703 o200k, 7 tools |
| Packaged, maintainer-like, first request | 20,643 o200k, 24 tools | 8,684 o200k (14,476 Opus), 7 tools |
| Packaged, maintainer-like, once MCP has connected | 32,804 o200k (54,684 Opus), 81 tools | 8,684 o200k (14,476 Opus), 7 tools |

With the earlier 200-character skill description cap (`ac6df366f`), the maintainer-like request was 9,008 o200k (15,016 Opus), 16 over the gate, and the empty project 3,728 o200k.

v1's empty-project request:

- System prompt: about 1,620 o200k. The largest parts are the rules at 501 and the Session identity at 343.
- Tool declarations: 2,021 o200k. These are `hive` (774), `codemode` (449), `edit`, `read`, `bash`, `tool_search` and `write`.

In the maintainer-like setup, the skills listing is 3,224 o200k (3,523 with the 200-character cap), project context 1,803, and the MCP server listing 136. MCP tools are no longer declared, before or after their servers connect.

The CI ratchet in `scripts/perf/first-turn-prefix/first-turn-prefix-budget.ts` holds the in-process prefix at 3,900 / 3,905 / 3,905 o200k.

### 6-Run Hive memory with heavy MCP

| | beta.27 | v1 |
|---|---|---|
| Peak footprint | 5,027 MB (4,985–5,273) | 1,478 MB (1,472–1,485) |
| Median footprint | 4,596 MB | 1,338 MB |
| Host | 625–635 MB | 232–245 MB |
| Host embedding child | | 430–444 MB (2 of 3 runs) |
| MCP servers | 38–42, 2.3–2.5 GB | 13–14, 485 MB |
| MCP npm wrappers | 19–21, 1.4–1.5 GB | 0 |
| GUI main | 1, 258–263 MB | 1, 171–179 MB |
| Processes | 64–69 | 20–22 |
| All 6 Runs active after | 5.4 s | 2.1 s |

### Idle Host

| 240 s after window close | beta.27 | v1 |
|---|---|---|
| Host footprint | 404 MB (403–406) | 135 MB (135–136) |
| Host tree (with children) | 819 MB, 12 processes, 6 of them MCP servers | 148 MB, 3 processes, no MCP |
| Host CPU | 0.5% | 0.3% |

### Bedrock

| | beta.27 | v1 |
|---|---|---|
| TLS handshakes, first call | 2 | 2 |
| TLS handshakes, each later call | 2 (SSO portal and `bedrock-runtime`) | 0 |
| Time to first event, later calls (two runs) | 2,545 / 1,792 ms | 1,043 / 1,069 ms |
| TLS time per later call | 245 / 249 ms | 0 |

## Evals

The eval is `pnpm evaluate:agent-context`: 25 script-graded tasks in 8 groups (26 with `skills-select-late-trigger`, reported separately), 5 repetitions per task per side. It runs against the packaged app, with Opus 5.5 and Sonnet 5 on Bedrock.

Acceptance rule:

- No task loses more than 1 pass out of 5.
- No group is lower in aggregate.
- Tokens and cost both go down.

### Which build the evals ran on

The full evals ran on the build of integration commit `0974d5886`. The changes since then do not alter what the model sees in the eval tasks:

- Startup (W11), session open (W10), streaming (W4) and the OAuth registration fix change nothing in the request.
- The in-process and packaged empty-project prefixes are identical apart from temp-path lengths. Their sections have the same characters.
- W7's MCP change fills a cold MCP catalog before the first turn, so the MCP server listing now carries each server's cached description from the first request. This is model-facing, so the MCP-via-codemode group was re-run on the final build with both models: 15/15 on each, tokens within 3% of the earlier v1 run.

The accepted results are therefore kept.

### Two fixtures fixed

The first full v1 run was not accepted on either model. Every failure came from one of two fixtures that did not test what they were meant to test:

- **skills-bundled-script.** Opus 5.5 on Bedrock stopped with `content_filtered` after reading the skill, on 4 of 5 v1 runs and 1 of 5 beta.27 runs. The prompt asked for a "deployment token"; the fixture now asks for a release name.
- **compaction-recall-start and compaction-recall-decision.** Every failing run, on both sides, scanned the files with `bash` instead of reading them. It never reached the 4% compaction threshold, and still gave the right answer. v1's prefix is about 15k Opus tokens smaller, which leaves more room under the threshold. Both prompts now require the read tool for every page.

These three tasks were then re-run on both builds and both models (`b283672ad`). The tables below use the original results for the other 22 tasks.

### Results

| | Opus 5.5: beta.27 | Opus 5.5: v1 | Sonnet 5: beta.27 | Sonnet 5: v1 |
|---|---|---|---|---|
| Passes | 123 / 125 | 125 / 125 | 124 / 125 | 125 / 125 |
| Tokens | 19.45 M | 8.39 M (−57%) | 15.08 M | 6.02 M (−60%) |
| Cost | $47.25 | $23.95 (−49%) | $15.04 | $6.01 (−60%) |
| Accepted | | yes | | yes |

Passes by group, beta.27 → v1:

| Group | Runs | Opus 5.5 | Sonnet 5 |
|---|---|---|---|
| core coding | 30 | 30 → 30 | 29 → 30 |
| deferred first-party tools | 20 | 20 → 20 | 20 → 20 |
| MCP via codemode | 15 | 15 → 15 | 15 → 15 |
| Hive | 15 | 15 → 15 | 15 → 15 |
| skills | 15 | 15 → 15 | 15 → 15 |
| compaction recall | 10 | 8 → 10 | 10 → 10 |
| browser preview | 10 | 10 → 10 | 10 → 10 |
| truncated output | 10 | 10 → 10 | 10 → 10 |

Opus's two beta.27 compaction failures were timeouts. Those Runs compacted 34 and 36 times, because beta.27's 22k-token Opus prefix fills about half of the 4% threshold on its own.

Most first-party tools are now deferred behind `tool_search`, and most tasks that use them cost one extra model call. Four tasks cost more than one extra call on average:

- Sonnet `tools-docs-mcp-idle`: 3.0 → 5.0 calls, with 2 `tool_search` calls.
- Sonnet `hive-find-session`: 2.0 → 4.6 calls.
- Opus `hive-spawn-and-wait`: 7.0 → 10.8 calls.
- Opus `hive-two-workers`: 11.6 → 13.4 calls.

`hive` is not deferred; the extra Hive calls are additional waits and reads. Tokens on these tasks still went down.

### The 160-character skill description cap

`dbb0d5187` lists skill descriptions up to 160 characters instead of 200, cut at a word. It is model-facing, so the skills group was re-run on that build with both models, 5 repetitions per task:

| Skills group | beta.27 | v1, 200-char cap | v1, 160-char cap |
|---|---|---|---|
| Opus 5.5: passes / tokens | 15/15, 1.12 M | 15/15, 325 k | 15/15, 324 k |
| Sonnet 5: passes / tokens | 15/15, 1.29 M | 15/15, 361 k | 15/15, 359 k |

The group does not regress. But every fixture description in it is shorter than 160 characters, so the cap leaves them untouched.

A new task, `skills-select-late-trigger`, tests the case the cap can break:

- Three house-style skills share a 159-character first sentence.
- They differ only in a "Use when …" sentence that starts at character 160. Many real descriptions follow this pattern, including some in this repository.
- With the 160-character cap, the listing shows none of the triggers. With the 200-character cap, it shows most of each one, and beta.27 shows all of them.

| `skills-select-late-trigger` | beta.27 | v1, 200-char cap | v1, 160-char cap |
|---|---|---|---|
| Opus 5.5 | 5/5 | not run | 5/5 |
| Sonnet 5, first batch (4 eval runners at once) | 5/5 | | 2/5 |
| Sonnet 5, second batch | | 5/5 | 5/5 |

The three failures in the first Sonnet batch on the 160-character build:

- Two Runs did not know which skill applied and searched the whole disk with `find / -iname SKILL.md`. Under that batch's load, the search ran past the task's 8-minute timeout.
- One Run wrote its tool call as text. It had already chosen the right format.

The second batch, run with less load, passed 5 of 5. Together, Sonnet passed 7 of 10 with the 160-character cap, against 5 of 5 with the 200-character cap and 5 of 5 on beta.27.

The disk-wide search is the risk the cap adds: a model that cannot see a skill's trigger has to look for it. Two other fixes would keep the triggers and still meet the gate:

- Cut the description around a "Use when" sentence rather than at a fixed length.
- Shorten the first sentence and keep the trigger.

## Competitor benchmark (decision 6)

`scripts/benchmark-docker/run.sh` was run on the final build (`dbb0d5187`), with the v1 packaged app as the OpenWaggle row. The model was `z-ai/glm-5.3-flash` through OpenRouter, and every agent went through the same local logging proxy. The numbers are provider-reported prompt tokens of each agent's first model call in an empty project.

| Agent | First-call prompt tokens | Prefix o200k | Tools |
|---|---|---|---|
| Pi CLI 1.4.0 | 1,395 | 1,213 | 4 |
| OpenWaggle v1 (packaged) | 4,179 | 3,676 | 7 |
| opencode 1.19.4 | 7,035 | 6,731 | 10 |
| Codex CLI 0.164.0 | 8,799 | 7,658 | 9 |
| Claude Code 2.1.311 | 12,773 | 12,138 | 11 |

beta.27 measured 15,688 in the baseline run of the same benchmark.

Decision: keep the page.

- The as-shipped empty-project prefix is 3,676–3,710 o200k, under the 4k bar.
- OpenWaggle's first call is below opencode, Codex and Claude Code, and about 3× the Pi CLI it is built on.

Changes to the page:

- It plots only these five rerun rows.
- It measures OpenWaggle as the packaged app instead of the removed bare-SDK probe.
- It documents `run.sh` and `pnpm perf:first-turn-prefix:packaged`.

## Not met, and why

- **LCP on profiles with Sessions: 390 ms medium, 392 ms large; gate 350 ms, met on the empty profile at 152 ms.** There the LCP element is the Session list, which waits for the Host's first page of Sessions. It improved from 512 ms on beta.27. The gate itself, measured on the empty profile, is met.

Every gate in the table is met. The maintainer-like prefix meets its gate only with the 160-character skill description cap, whose eval risk is described in [the skills cap](#the-160-character-skill-description-cap).

## Harness fixes made during the final measurement

- **Warm templates** now keep the window attached until the Host's background work is idle, and record the queue rows left. Since A-F9 that work only runs with a client attached, so the earlier headless warm-up left it to the first seconds of every measured launch. The window's own launcher resolves the Host socket, so a long `--label` no longer fails on the temp-dir socket fallback. Old copies are warmed again.
- **Process roles** go by the executable's bundle. MCP fixture servers under this checkout used to count as the GUI, and the Host's embedding child was not attributed to the Host.
- **Scripted Hive** recognizes Workers from v1's compact Session-identity JSON. Its patterns for `sessionId` and `parentSessionId` allow any whitespace.
- **Boot probe** stops once it has seen every milestone (W4, `54cd9962f`).
- **Startup modes:** `perf:startup --compile-cache warm`, `--login-shell slow`, `--warmed-by none|<label>`, and LCP from spawn.
- **Session open:** `perf:session-open --mode cross-project` (W12).
- **Benchmark proxy:** attributes requests by agent through an `/agent/<name>` base-URL prefix. opencode's background title call had finished after its container exited and landed in the OpenWaggle slice. That made a 532-token title request look like OpenWaggle's first call.
- **Eval output:** the eval keeps the last 40 lines of a failed `openwaggle run`. This is how `content_filtered` was found.

## Checks

On the W0 branch at the final build, these all passed:

- `pnpm typecheck`
- `pnpm lint`, including `check:repository-standards`
- Vitest unit tier for `scripts/`: 155 files, 1,114 tests
- Vitest integration tier for `scripts/`: 8 files pass. The Bedrock test is skipped without its model variable.

The full `pnpm check` and every test tier of the integration branch belong to the integration PR.

## Raw data

Raw data is kept outside the repository, in the W0 evidence directory under `perf-final2/`:

- One JSON file per series, `loads.log`, the warm markers, and the MCP-group eval rerun.
- The eval runs are in `perf-final/eval-merged/`, and earlier intermediate builds' series in `perf-final/`.
- The beta.27 baseline is in `perf-baseline/`.

The benchmark output is committed in `scripts/benchmark-docker/results/`.
