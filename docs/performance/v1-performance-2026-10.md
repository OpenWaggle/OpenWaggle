# v1 performance: before and after (October 2026)

This report compares 1.0.0-beta.27 (`77b9814b5`) with the v1 performance integration branch on every gate in the v1 performance plan. Both sides are packaged builds measured on the same machine in the same session, with interleaved runs.

## Gates

"beta.27" and "v1" are medians of interleaved runs measured in this session. Ranges are min–max. The "plan baseline" column is the value the plan was written against. It was measured earlier on a quieter machine, so compare v1 with the beta.27 column.

| Area | Gate | Plan baseline | beta.27 | v1 | Met |
|---|---|---|---|---|---|
| Cold launch → Session list | ≤ 1.0 s | 1.75 s | 1.80 s (1.75–2.10) | 1.13 s (1.02–1.98) | no |
| Cold launch → first paint | ≤ 0.8 s | 1.68 s | 1.77 s (1.72–2.07) | 0.89 s (0.79–1.16) | no |
| Warm launch → Session list | ≤ 0.8 s | 1.05 s | 1.08 s (1.01–1.27) | 0.70 s (0.65–0.78) | yes |
| Renderer LCP, warm launch | ≤ 350 ms | 516 ms | 530 ms (516–620) | 358 ms (344–396) | no, by 8 ms |
| Renderer LCP, cold launch | ≤ 350 ms | 516 ms | 556 ms (524–608) | 534 ms (508–1,376) | no |
| `openwaggle --version` | ≤ 0.3 s | 0.50 s | 508 ms (496–573) | 104 ms (101–266) | yes |
| Open a large Session: IPC bytes | −80% | MB-scale | 166.6 MB | 30.7 MB (−82%) | yes |
| Open a large Session: time to the last message | faster | | 434 ms (430–1,800) | 976 ms (626–2,080) | no |
| Streaming at 4× CPU throttle: main thread busy | ≤ 30% | 61.5% | 86.6% (82.3–88.0) | 30.5% (26.4–35.1) | no, by 0.5 points |
| Streaming at 4× CPU throttle: p99 frame | ≤ 20 ms | 42.6 ms | 34.8 ms (25.1–92.2) | 16.1 ms (9.4–16.7) | yes |
| First-turn prefix, empty project | ≤ 4k o200k | ~10k | 13,088 o200k | 3,722 o200k | yes |
| First-turn prefix, maintainer-like setup | ≤ 15k Opus | 52.5k | 54,493 Opus (32,689 o200k) | 14,970 Opus (8,980 o200k) | yes |
| Memory, 6-Run Hive with heavy MCP | ≤ 4 GB | 8.0 GB | 4,896 MB (4,880–5,120) | 4,198 MB (1,598–4,648) | no |
| Idle Host 240 s after window close | ≤ 250 MB, ~0% CPU | 0.4–1.5 GB | 421 MB, 0.33% | 141 MB, 0.16% | yes |
| Bedrock time to first byte per call | −250 ms | | 1,617 / 1,644 ms | 1,213 / 1,316 ms | yes |
| Agent evals | no group regresses; tokens and cost down | | see [Evals](#evals) | accepted on both models | yes |
| Regression | `pnpm check` and all test tiers green | | | see [Checks](#checks) | |

Startup is from the empty profile with a cold compile cache, the first launch after an update. The [Startup](#startup) section has the warm-cache numbers. All rows use the final build except these, which were measured on the 6d06526f9 build: `--version`, compile-cache-warm launches, and the medium and large profiles. Commits after 6d06526f9 did not touch startup.

## Method

### Builds

Both apps were built the same way: `pnpm build`, then `electron-builder --dir` with code signing off.

- beta.27: `77b9814b5`.
- v1: the integration branch at `0974d5886`, merged into the W0 branch as `eb2195d4f`. This is the final code state for the gates.
- Startup and profile launches also ran on an intermediate build, the integration branch at `6d06526f9`.

### Harnesses

All harnesses live in `scripts/perf/`. Every measured launch uses a throwaway profile: its own HOME, user data, Pi agent dir and project. The real profile, app and Host are never touched. Runs alternate between the two builds (beta.27, v1, v1, beta.27, …) so that load changes hit both sides.

| Gate | Command | Runs per side |
|---|---|---|
| Launch, `--version`, profiles | `pnpm perf:startup --mode cold\|warm\|version [--compile-cache cold\|warm] [--template <profile>] [--warmed-by <label>\|none]` | 10 |
| Large Session open | `pnpm perf:session-open --template <profile>` | 10 (medium profile), 5 (large, v1 only) |
| Streaming | `pnpm perf:streaming --cpu-throttle 4` | 10 |
| Idle Host | `pnpm perf:idle-host` | 3 |
| Hive memory | `pnpm perf:hive-memory` | 3 |
| Bedrock TTFB | `pnpm perf:bedrock-ttfb` (20 sequential calls) | 2 × 20 calls |
| Prefix, in-process | `pnpm perf:first-turn-prefix` | 1 (deterministic) |
| Prefix, packaged | `pnpm perf:first-turn-prefix:packaged --setup empty\|maintainer` | 1 (deterministic) |
| Agent evals | `pnpm evaluate:agent-context --reps 5 --baseline <beta.27 dir>` | 125 per model |
| Competitor benchmark | `scripts/benchmark-docker/run.sh` with `BENCH_OPENWAGGLE_APP` | 1 |

Idle Host and Hive memory each take 4–7 minutes per run, so they ran 3 times per side instead of 10. Their spread is small next to the gaps they measure.

What the harnesses measure:

- **Launch timings.** Measured from spawn. "Session list" is the first frame showing the Session list, and "chat ready" is when the composer is editable. In v1 both appear together.
- **LCP.** Reported two ways: after renderer navigation (the gate) and from spawn. v1 opens the window before the Host is ready, so LCP after navigation includes waiting for the Host.
- **Compile cache.** v1 keeps a V8 compile cache under `~/Library/Caches/OpenWaggle`.
  - "Cold cache" is a fresh HOME, like the first launch after an update.
  - "Warm cache" primes the cache once per build and copies it into every measured HOME.
  - beta.27 has no compile cache, so its two series differ only by load.
- **Session open.** Opens the generated 3,600-message Session and waits until its last message renders. IPC is counted in the main process through `--inspect`.
- **Streaming.** A fake OpenAI SSE provider streams a long answer while the renderer's CPU is throttled 4×.
- **Hive memory.**
  - A scripted fake provider has the Queen spawn four Workers. Worker 1 spawns the fifth, because the Host allows four running children per parent.
  - Each of the 6 Sessions then holds a long `bash sleep`.
  - Each Session has six MCP fixture servers: three local and three real npm packages at pinned versions.
  - Memory is the summed physical footprint of the app's process tree over 20 samples.
- **Idle Host.** Opens the app, closes the window, and samples the Host tree at 30, 120 and 240 s after close. The table reports the 240 s sample.
- **Bedrock.** Runs in-process through OpenWaggle's Pi runtime against `eu.anthropic.claude-sonnet-5`. It counts TLS handshakes per call. beta.27 was measured from a temporary worktree of `77b9814b5` with the same test file.

### Profiles

Profiles come from `pnpm perf:generate-profile`:

- **Medium:** 40 Sessions, 19,474 nodes.
- **Large:** 1,800 Sessions, 301,523 nodes, 1.46 GB, including 4 Sessions of 3,600 messages.

Each build first opens its own copy of a profile once, as an upgrade would ("warm template"). beta.27 cannot open the large profile (see [Large profile](#large-profile)). Its large-profile runs therefore used the copy v1 warmed.

### Machine and load

Apple M4 Max, 14 cores, 36 GB, macOS 26.6.2, Node 24.

Other Hive Workers were building and testing on the same machine during the measurements. The table below gives the 1-minute load average at the start and end of each series. Load was 5–28. Interleaving spreads it over both sides, but absolute times run higher than on an idle machine.

| Series | Load at start → end |
|---|---|
| Empty profile, cold launch, cold cache (final build) | 7.7 → 8.4 |
| Empty profile, warm launch (final build) | 8.4 → 6.7 |
| Empty profile, cold launch, warm cache (6d06526f9) | 5.6 → 4.9 |
| `--version` (6d06526f9) | 9.8 → 10.9 |
| Medium profile (6d06526f9) | 10.9 → 27.9 |
| Large profile (6d06526f9) | 27.9 → 13.9 |
| Session open, medium | 5.6 → 25.0 |
| Streaming | 13.5 → 11.2 |
| Idle Host (evals running) | 11.2 → 15.6 |
| Hive memory (eval re-runs running) | 6.5 → 23.3 |
| Bedrock | 10.0 → 7.0 |

## Results by area

### Startup

Empty profile, 10 runs per side.

| Launch | Metric | beta.27 | v1 |
|---|---|---|---|
| Cold, cold cache | window created | 1,557 ms | 617 ms |
| | Host listening | 1,452 ms | 1,017 ms |
| | first paint | 1,767 ms | 891 ms |
| | Session list | 1,802 ms | 1,127 ms |
| | chat ready | 2,075 ms | 1,127 ms |
| | LCP after navigation | 556 ms | 534 ms |
| | LCP from spawn | 2,101 ms | 1,174 ms |
| Cold, warm cache (6d06526f9) | first paint | 2,113 ms | 889 ms |
| | Session list | 2,146 ms | 1,067 ms |
| | LCP after navigation | 598 ms | 552 ms |
| Warm (second launch) | window created | 854 ms | 366 ms |
| | Host listening | 762 ms | 271 ms |
| | first paint | 1,041 ms | 675 ms |
| | Session list | 1,081 ms | 702 ms |
| | LCP after navigation | 530 ms | 358 ms |
| `--version`, cold cache (6d06526f9) | | 508 ms | 104 ms |
| `--version`, warm cache (6d06526f9) | | 512 ms | 103 ms |

A warm compile cache barely moves cold v1 launches: 1,067 ms against 1,127 ms. In a cold launch the Host is on the critical path. The window is created at about 0.6 s and paints at about 0.9 s, but the Session list waits for the Host, which listens at about 1.0 s. LCP after navigation is the time from navigation to the Session list. Its element appears only once the Host answers.

### Medium and large profiles

| Profile | Metric | beta.27 | v1 |
|---|---|---|---|
| Medium, warm cache (6d06526f9) | Host listening | 2,037 ms | 1,493 ms |
| | Session list | 2,544 ms (1,696–3,121) | 1,708 ms (853–3,133) |
| Large, copy warmed by v1 (6d06526f9) | Session list | renderer never opened, 10 of 10 runs timed out at 60 s | 1,128 ms (859–2,338) |
| Large, unwarmed first open (v1 only, n=3) | Host listening | never listened in 37 min (baseline) | 1,328 ms (1,115–3,599) |
| | Session list | | 1,466 ms (1,268–3,754) |

The medium series ran while load rose from 11 to 28, so its ranges are wide.

#### Large profile

beta.27's Host never starts listening on the large profile. It runs embedding inference on its main thread and did not commit one batch in 37 minutes. v1 listens in about 1.3 s on the same profile, unwarmed. Its first warm-up, run headless with `openwaggle host start`, finished in 34 s.

### Large Session open

| | beta.27 | v1 |
|---|---|---|
| IPC invoke bytes | 166.6 MB | 30.7 MB |
| `sessions:get-tree` | ×4, 95.3 MB | ×1, 1.7 MB |
| `sessions:get-workspace` | ×1, 47.9 MB | ×3, 6.1 MB |
| `sessions:get-detail` | ×2, 22.9 MB | ×2, 22.9 MB |
| `sessions:resources:backfill` | | ×24, 709 ms |
| Time to last message | 434 ms (430–1,800) | 976 ms (626–2,080) |
| Renderer JS heap after open | 221 MB | 75 MB |

v1 moves 82% fewer bytes, but it reaches the last message later. The four lowest-load pairs measured 430 ms for beta.27 and 626–718 ms for v1. `sessions:get-detail` still sends the full 22.9 MB twice. The new resource backfill calls sit on the open path.

On the large profile (v1 only, 5 runs), the same open moves 30.8 MB and takes 770 ms (632–2,124).

### Streaming at 4× CPU throttle

| | beta.27 | v1 |
|---|---|---|
| Renderer main thread busy | 86.6% | 30.5% |
| Frame p50 / p95 / p99 | 8.4 / 16.9 / 34.8 ms | 8.3 / 9.2 / 16.1 ms |
| Frames over 33 ms / 100 ms | 21 / 3 | 11.5 / 2 |
| `agent:event` sends | 1,507 (443 KB) | 365 (112 KB) |

The streaming numbers were measured on the final build, which includes the transcript stick-to-bottom fix (`2e82656cb`).

### First-turn prefix

| Measurement | beta.27 | v1 |
|---|---|---|
| In-process, independent / Queen / Worker | 13,304 / 13,301 / 11,289 o200k | 3,788 / 3,788 / 3,786 o200k |
| Packaged, empty project | 13,088 o200k (~21.8k Opus), 24 tools | 3,722 o200k (6,205 Opus), 7 tools |
| Packaged, maintainer-like | 32,689 o200k (54,493 Opus), 81 tools | 8,980 o200k (14,970 Opus), 7 tools |

v1's empty-project request breaks down as follows:

- System prompt: 1,618 o200k. The largest parts are rules at 501 and the Session identity at 343.
- Tool declarations: 2,021 o200k. These are `hive` (774), `codemode` (449), `edit`, `read`, `bash`, `tool_search` and `write`.

In the maintainer-like setup, skills take 3,523 o200k and project context 1,802. MCP tools are no longer declared on the first turn.

The CI ratchet in `scripts/perf/first-turn-prefix/first-turn-prefix-budget.ts` holds the in-process prefix at 3,900 / 3,905 / 3,905 o200k.

### 6-Run Hive memory with heavy MCP

| | beta.27 | v1 |
|---|---|---|
| Peak footprint | 4,896 MB (4,880–5,120) | 4,198 MB (1,598–4,648) |
| Median footprint | 4,301 MB | 3,991 MB |
| Host | 637 MB | 232 MB |
| MCP servers | 36, ~2.3 GB | 36, 1.9–2.3 GB |
| MCP npm wrappers | 18–21, ~1.3–1.5 GB | 18, ~1.3 GB |
| GUI main processes | 7, ~470 MB | 3, ~630 MB |
| Processes | 67 | 63 |

The Host is a third of its former size, but every Session still starts its own six MCP servers. In one of the three v1 runs only 10 servers started, and that run peaked at 1.6 GB.

### Idle Host

| 240 s after window close | beta.27 | v1 |
|---|---|---|
| Host footprint | 421 MB (406–424) | 141 MB (140–175) |
| Host tree (with children) | 822 MB, 12 processes | 154 MB, 3 processes |
| Host CPU | 0.33% | 0.16% |

### Bedrock

| | beta.27 | v1 |
|---|---|---|
| TLS handshakes, first call | 2 | 2 |
| TLS handshakes, each later call | 2 (SSO portal and `bedrock-runtime`) | 0 |
| Time to first event, later calls (two runs) | 1,617 / 1,644 ms | 1,213 / 1,316 ms |
| TLS time per later call | 243 / 254 ms | 0 |

## Evals

The eval is `pnpm evaluate:agent-context`: 25 script-graded tasks in 8 groups, 5 repetitions per task per side. It runs against the packaged app, with Opus 5.5 and Sonnet 5 on Bedrock.

Acceptance rule:

- No task loses more than 1 pass out of 5.
- No group is lower in aggregate.
- Tokens and cost both go down.

### Two fixtures fixed

The first full v1 run was not accepted on either model. Every failure came from one of two fixtures that did not test what they were meant to test:

- **skills-bundled-script.** Opus 5.5 on Bedrock stopped with `content_filtered` after reading the skill. This happened on 4 of 5 v1 runs and 1 of 5 beta.27 runs. The prompt asked for a "deployment token". The fixture now asks for a release name.
- **compaction-recall-start and compaction-recall-decision.** Every failing run on both sides scanned the files with `bash` instead of reading them, never reached the 4% compaction threshold, and still gave the right answer. v1's prefix is about 15k Opus tokens smaller, which leaves more room under the threshold. Both prompts now require the read tool for every page.

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

Opus's two beta.27 compaction failures were timeouts: those Runs compacted 34 and 36 times. beta.27's 22k-token Opus prefix sits at about half of the 4% threshold on its own.

Most first-party tools are now deferred behind `tool_search`, and most tasks that use them cost one extra model call. Four tasks cost more than one extra call on average:

- Sonnet `tools-docs-mcp-idle`: 3.0 → 5.0 calls, with 2 `tool_search` calls.
- Sonnet `hive-find-session`: 2.0 → 4.6 calls.
- Opus `hive-spawn-and-wait`: 7.0 → 10.8 calls.
- Opus `hive-two-workers`: 11.6 → 13.4 calls.

`hive` is not deferred. The extra Hive calls are additional waits and reads. Tokens on these tasks still went down.

## Competitor benchmark (decision 6)

`scripts/benchmark-docker/run.sh` was run with the v1 packaged app as the OpenWaggle row. The model was `z-ai/glm-5.3-flash` through OpenRouter, and every agent went through the same local logging proxy. The numbers are provider-reported prompt tokens of the first model call in an empty project.

| Agent | First-call prompt tokens | Prefix o200k | Tools |
|---|---|---|---|
| Pi CLI 1.4.0 | 1,395 | 1,213 | 4 |
| OpenWaggle v1 (packaged) | 4,201 | 3,694 | 7 |
| opencode 1.19.4 | 7,035 | 6,731 | 10 |
| Codex CLI 0.164.0 | 8,769 | 7,658 | 9 |
| Claude Code 2.1.311 | 12,811 | 12,138 | 11 |

In the baseline run of the same benchmark, beta.27 measured 15,688.

Decision: keep the page.

- The as-shipped empty-project prefix is 3,694–3,722 o200k, under the 4k bar.
- OpenWaggle's first call is below opencode, Codex and Claude Code, and about 3× the Pi CLI it is built on.

Changes to the page:

- It now plots only these five re-run rows.
- It measures OpenWaggle as the packaged app instead of the removed bare-SDK probe.
- It documents `run.sh` and `pnpm perf:first-turn-prefix:packaged`.

## Not met, and why

- **Cold launch → Session list (1.13 s, gate 1.0 s), first paint (0.89 s, gate 0.8 s), and LCP (534 ms cold, 358 ms warm; gate 350 ms).** The window and first paint come early. The Session list, the LCP element, waits for the Host, which listens at about 1.0 s in a cold launch. A warm compile cache saves only about 60 ms. Worker W11 is working on this.
- **Large Session open time (976 ms against 434 ms).** Bytes fell 82%, but `sessions:get-detail` still sends 22.9 MB twice, and 24 resource backfill calls run during the open. Worker W10 is moving get-detail to a window and taking the backfill off the open path.
- **Streaming main-thread busy (30.5%, gate 30%).** p99 passes with room to spare. Busy time fell from 86.6% and is within run-to-run noise of the gate. Range: 26.4–35.1%.
- **6-Run Hive memory (4.2 GB, gate 4 GB).** The Host went from 637 to 232 MB. Each of the six Sessions still runs its own six MCP server processes and their npm wrappers, about 3.2–3.6 GB together. Meeting the gate needs MCP servers shared across Sessions or started on first use.

## Harness fixes made during the final measurement

- `perf:startup --compile-cache warm` primes and seeds the v1 compile cache. `--version` now also runs on a throwaway HOME. LCP is also reported from spawn.
- Warm templates start the Host with `openwaggle host start`, because v1's Host exits when launched without a client.
- `--warmed-by none|<label>` measures unwarmed first opens, or gives every build the copy one build warmed.
- The scripted Hive did not recognize Workers from v1's compact Session-identity JSON. Every Worker acted as a Queen and hit the Host's 16-Run ceiling. The first v1 memory run was invalid and was repeated.
- The eval keeps the last 40 lines of a failed `openwaggle run`. This is how `content_filtered` was found.

## Checks

On the W0 branch at the final build, these all passed:

- `pnpm typecheck`
- `pnpm lint`, including `check:repository-standards`
- Vitest unit tier for `scripts/`: 154 files, 1,102 tests
- Vitest integration tier for `scripts/`: 8 files pass. The Bedrock test is skipped without its model variable.

The full `pnpm check` and every test tier on the integration branch are part of the integration PR.

## Raw data

Raw data is kept outside the repository in the W0 evidence directory under `perf-final/`:

- One JSON file per series, the eval `runs.jsonl` and `summary.json` files, and the benchmark proxy logs.
- `startup-6d06526f9/` holds the startup series measured on the intermediate build.
- `invalid-hive-memory/` holds the Hive memory run discarded for the harness bug.

The beta.27 baseline and its write-up are in `perf-baseline/`. The benchmark output is committed in `scripts/benchmark-docker/results/`.
