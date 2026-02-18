export interface PipelineRuntimeEnvironment {
  nowMs(): number;
  nowIso(): string;
  random(): number;
  sleep(delayMs: number): Promise<void>;
}

export interface PipelineRuntimeEnvironmentOverrides {
  readonly nowMs?: () => number;
  readonly nowIso?: () => string;
  readonly random?: () => number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

export function createPipelineRuntimeEnvironment(
  overrides: PipelineRuntimeEnvironmentOverrides = {},
): PipelineRuntimeEnvironment {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  const nowIso = overrides.nowIso ?? (() => new Date(nowMs()).toISOString());
  const random = overrides.random ?? (() => Math.random());
  const sleep = overrides.sleep ?? defaultSleep;

  return {
    nowMs,
    nowIso,
    random,
    sleep,
  };
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
