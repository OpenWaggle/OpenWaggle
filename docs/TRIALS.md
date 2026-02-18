# External Trial Instrumentation

Goal: capture a measurable `time-to-diagnose` metric for broken agent workflows.

This workflow records:
- participant
- mode (`baseline` or `condukt-ai`)
- expected failure boundary (task + error code)
- participant diagnosis
- elapsed diagnosis time
- accuracy

## 1) Prepare a broken trace

```bash
pnpm --filter condukt-ai quickstart:broken
```

This writes `packages/core/trace.quickstart.json`.

## 2) Start a timed trial session

```bash
pnpm --filter condukt-ai trial:start \
  --participant p1 \
  --scenario quickstart-broken \
  --mode condukt-ai \
  --trace packages/core/trace.quickstart.json
```

Output includes a session file path (stored under `packages/core/trials/sessions/` by default).

Legacy note:
- mode alias `condukt` is still accepted and normalized to `condukt-ai` for compatibility.

For baseline runs without a trace-driven expectation:

```bash
pnpm --filter condukt-ai trial:start \
  --participant p1 \
  --scenario quickstart-broken \
  --mode baseline \
  --expected-task draft \
  --expected-error-code CONTRACT_OUTPUT_VIOLATION
```

## 3) Finish session after participant gives diagnosis

```bash
pnpm --filter condukt-ai trial:finish \
  --session packages/core/trials/sessions/<session-id>.session.json \
  --diagnosed-task draft \
  --diagnosed-error-code CONTRACT_OUTPUT_VIOLATION
```

This appends one record to `packages/core/trials/diagnosis-metrics.jsonl`.

## 4) Generate summary report

```bash
pnpm --filter condukt-ai trial:report
pnpm --filter condukt-ai trial:report -- --json
```

Report includes:
- total records
- accuracy
- median and p90 elapsed diagnosis times
- median speedup ratio (`baseline / condukt-ai`)
- paired sample count and paired speedup metrics

## 5) Apply quality gates (recommended)

Use explicit thresholds to fail reports that are too weak for decisions:

```bash
pnpm --filter condukt-ai trial:report -- \
  --min-records 6 \
  --min-accuracy 0.75 \
  --min-pairs 3 \
  --min-speedup 1.5
```

Gate behavior:
- exits non-zero when any threshold is not met
- prints exact gate failure reasons

## 6) Export markdown for sharing

```bash
pnpm --filter condukt-ai trial:report -- \
  --markdown-out packages/core/trials/report.md \
  --title "Condukt AI Trial Report" \
  --max-pairs 20 \
  --min-records 6 \
  --min-pairs 3 \
  --min-speedup 1.5
```

This writes a shareable markdown report with:
- overview metrics
- by-mode table
- paired sample table
- gate status and reasons (when gates are configured)

## Suggested 2-week target

- collect at least 3 external participants
- run one baseline + one condukt-ai diagnosis per participant
- success criterion: at least one participant repeats usage unprompted
