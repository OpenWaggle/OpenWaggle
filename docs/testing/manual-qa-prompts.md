# Manual QA Prompt Checklist (Continuation + Approvals)

Use this checklist to validate continuation, tool approval flow, trust persistence, and orchestration UX before merge.

## Setup

1. Start app with `pnpm dev`.
2. In Settings:
   - Execution mode: `Default permissions`
   - Project path: repository root
3. Optional reset for clean trust state:
   - `rm -f .openwaggle/config.local.toml`
4. Open a **new thread** for each scenario group if you want isolated runs.

## How To Read Outcomes

- `Pass`: behavior matches Expected Outcome.
- `Fail`: copy logs from **Open Logs** + terminal output + screenshot.
- If a prompt depends on prior approvals/trust, run in order.
- If your `.openwaggle/config.local.toml` already trusts `echo*`, Group A/B should not require approval for those commands.

---

## Group A — Approval + Continuation Baseline

### A1
Prompt:

```text
Please do these tool calls in this exact order:
1) runCommand: `echo "pre-approved command"`
2) runCommand: `echo "second command should wait for the first approval"`
After both complete, summarize what happened in one sentence.
```

Expected outcome:

- First command may require approval if trust is empty.
- If approval is needed, approval controls must be visible (no silent stall).
- After approving, run continues (second command can proceed / request its own approval).

### A2
Prompt:

```text
Now run: `echo "continuation check"` and summarize in one sentence.
```

Expected outcome:

- Thread continues normally (no no-op run, no `unexpected tool_use_id` style error).

---

## Group B — Trusted Command UX (No Flash / No Re-approval)

### B1
Prompt:

```text
Run: `echo "trust-seed-command"` and return output only.
```

Expected outcome:

- First run may require approval.

### B2
Prompt:

```text
Run: `echo "trust-seed-command"` again and return output only.
```

Expected outcome:

- Should execute without showing approval controls.
- No visible approval-banner flash for a trusted call.

---

## Group C — Deny Path + Recovery

### C1
Prompt:

```text
Run: `git clean -fd` and summarize.
```

Expected outcome:

- Deny approval in UI.
- Tool shows denied/error state cleanly.

### C2
Prompt:

```text
Run: `echo "still working after deny"` and summarize.
```

Expected outcome:

- Conversation remains usable after denied tool call.

---

## Group D — writeFile / editFile Trust Persistence

### D1
Prompt:

```text
Create `tmp/manual-a.txt` with content `alpha`.
```

### D2
Prompt:

```text
Create `tmp/manual-b.txt` with content `beta`.
```

### D3
Prompt:

```text
Edit `tmp/manual-a.txt` replacing `alpha` with `alpha-updated`.
```

### D4
Prompt:

```text
Edit `tmp/manual-b.txt` replacing `beta` with `beta-updated`.
```

### D5
Prompt:

```text
Read both files and print contents.
```

Expected outcome:

- First write/edit may ask approval.
- Later similar write/edit should not repeatedly ask (trust persisted).

---

## Group E — webFetch Pattern Trust

### E1
Prompt:

```text
Use webFetch on https://react.dev/learn/react-compiler and summarize in 2 bullets.
```

### E2
Prompt:

```text
Use webFetch on https://react.dev/learn/thinking-in-react and summarize in 2 bullets.
```

### E3
Prompt:

```text
Use webFetch on https://react.dev/reference/react/useEffect and summarize in 2 bullets.
```

Expected outcome:

- First fetch may require approval.
- Same trusted pattern should reduce repeat approvals.
- Different path family may still require approval.

---

## Group F — Orchestration Completion + Follow-up

### F1
Prompt:

```text
Orchestrate these 5 tasks in parallel and return a concise report:
architecture hotspots, test gaps, error handling risks, DX pain points, quick wins.
```

Expected outcome:

- Sub-agent statuses complete (no permanently running spinner after completion).

### F2
Prompt:

```text
Run: `echo "post-orchestrate health check"` and summarize.
```

Expected outcome:

- Follow-up works immediately after orchestration completion.

---

## Group G — Restart Continuation

1. Close app.
2. Reopen app.
3. Open same thread.

### G1
Prompt:

```text
Continue this thread and run: `echo "after restart continuation"`.
```

### G2
Prompt:

```text
Run one more: `echo "second after restart"` and summarize.
```

Expected outcome:

- No continuation contract errors.
- Thread remains interactive.

---

## Failure Capture Template

When a prompt fails, capture:

1. Prompt ID (e.g., `A1`)
2. Exact UI symptom
3. `Open Logs` output
4. Terminal logs around the same timestamp
5. Screenshot

## Common Failure Signatures

- Tool row shows `(approval needed)` but no approval banner/buttons render:
  - Capture both renderer logs and terminal logs.
  - Include whether the tool-call had `pendingExecution` payload and whether it was stringified/wrapped.
- Trusted command still asks for approval:
  - Include current `.openwaggle/config.local.toml` `allowPatterns` for the tool.
  - Include exact command string from tool args (including whitespace/quotes).
