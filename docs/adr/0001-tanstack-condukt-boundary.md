# ADR 0001: TanStack AI and Condukt Boundary

- Status: Accepted
- Date: 2026-02-20
- Owners: OpenHive Core

## Context

OpenHive uses TanStack AI as the primary runtime for model adapters, tool execution, and streaming chat behavior.  
`condukt-ai` was integrated to provide orchestration capabilities TanStack AI does not currently provide out of the box.

We need a clear boundary so the codebase does not drift into two overlapping LLM execution stacks.

## Decision

1. TanStack AI remains the primary chat/model/tool execution layer.
2. Condukt remains the orchestration/control layer for multi-task runs (scheduling, run lifecycle, persistence hooks, cancellation/retry semantics).
3. OpenHive will not adopt Condukt provider helpers as part of the main runtime path.
4. Condukt `Pipeline` and `trials` stay available but optional; they are not part of the critical chat path for now.

## Why

- Keeps one source of truth for provider/model behavior (`providerRegistry` + TanStack adapters).
- Avoids duplicated abstractions for the same responsibility.
- Allows OpenHive to benefit from Condukt orchestration without increasing runtime complexity.

## Scope Mapping

- TanStack AI (primary): model selection, adapter execution, server-tool loop, chat streaming protocol.
- Condukt (adopted now): orchestration engine, run/task eventing, checkpointable run state model.
- Condukt (optional): Pipeline graph runtime, trial instrumentation/reporting helpers.

## Pipeline and Trials in OpenHive

### Pipeline

Pipeline is valuable if OpenHive introduces deterministic non-chat workflows, for example:
- background repository analysis flows,
- multi-step refactor plans with strict typed boundaries,
- scheduled or headless maintenance jobs.

Pipeline is not required for the interactive chat orchestration path today.

### Trials

Trials are valuable for product validation and benchmarking, for example:
- measuring diagnosis speed/accuracy across variants,
- evaluating orchestration UX impact before rollout decisions.

Trials are not runtime-critical and should remain outside the request path.

## Adoption Triggers

Adopt Pipeline in the main product only when all are true:
1. At least two non-chat workflows need typed step graphs and deterministic retries.
2. The workflows cannot be cleanly represented by current orchestration task model alone.
3. We commit to maintaining Pipeline-oriented test coverage in OpenHive CI.

Adopt Trials in product workflow only when all are true:
1. A KPI decision depends on structured diagnosis/performance records.
2. There is an explicit owner for trial protocol and report review cadence.
3. Storage/privacy expectations for trial data are documented.

## Consequences

Positive:
- cleaner architecture boundaries,
- lower maintenance risk,
- simpler provider/model evolution path.

Trade-off:
- some Condukt capabilities remain unused until explicit triggers are met.

## Revisit Plan

Re-evaluate this ADR after the next two orchestration milestones or by 2026-05-01, whichever comes first.
