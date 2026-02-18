import { expect, test } from "vitest";

import { validateReleaseIdentity } from "../src/release_identity.js";

test("validateReleaseIdentity passes on canonical condukt-ai metadata", () => {
  const errors = validateReleaseIdentity({
    packageName: "condukt-ai",
    repositoryUrl: "git+https://github.com/diego-tech-dev/condukt-ai.git",
    homepageUrl: "https://github.com/diego-tech-dev/condukt-ai/tree/main/packages/core",
    bugsUrl: "https://github.com/diego-tech-dev/condukt-ai/issues",
    readme: 'pnpm add condukt-ai zod\nimport { Pipeline } from "condukt-ai";',
    publishingDoc: "pnpm npm view condukt-ai\nimport('condukt-ai')",
    trialsDoc: "mode (`baseline` or `condukt-ai`)",
    traceWalkthroughDoc: "--mode condukt-ai",
  });

  expect(errors).toEqual([]);
});

test("validateReleaseIdentity reports legacy drift", () => {
  const errors = validateReleaseIdentity({
    packageName: "condukt",
    repositoryUrl: "git+https://github.com/diego-tech-dev/missiongraph.git",
    homepageUrl: "https://github.com/diego-tech-dev/missiongraph/tree/main/legacy-ts",
    bugsUrl: "https://github.com/diego-tech-dev/missiongraph/issues",
    readme: 'pnpm add condukt zod\nimport { Pipeline } from "condukt";',
    publishingDoc: "pnpm npm view condukt\nimport('condukt')",
    trialsDoc: "mode (`baseline` or `condukt`)",
    traceWalkthroughDoc: "--mode condukt",
  });

  expect(errors.length).toBeGreaterThan(0);
  expect(errors.join("\n")).toContain("package name must be condukt-ai");
  expect(errors.join("\n")).toContain("legacy `condukt` package reference");
  expect(errors.join("\n")).toContain("homepage url must include /tree/main/packages/core");
});
