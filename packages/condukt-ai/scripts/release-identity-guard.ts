import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateReleaseIdentity } from "../src/release_identity.js";

interface PackageMetadata {
  readonly name: unknown;
  readonly repository?: {
    readonly url?: unknown;
  };
  readonly homepage?: unknown;
  readonly bugs?: {
    readonly url?: unknown;
  };
}

async function main(): Promise<void> {
  const packageJson = await readJson<PackageMetadata>("package.json");
  const readme = await readText("README.md");
  const publishingDoc = await readText("docs/PUBLISHING.md");
  const trialsDoc = await readText("docs/TRIALS.md");
  const traceWalkthroughDoc = await readText("docs/TRACE_WALKTHROUGH.md");

  const errors = validateReleaseIdentity({
    packageName: toStringOrEmpty(packageJson.name),
    repositoryUrl: toStringOrEmpty(packageJson.repository?.url),
    homepageUrl: toStringOrEmpty(packageJson.homepage),
    bugsUrl: toStringOrEmpty(packageJson.bugs?.url),
    readme,
    publishingDoc,
    trialsDoc,
    traceWalkthroughDoc,
  });

  if (errors.length > 0) {
    console.error("Release identity guard failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Release identity guard passed.");
}

async function readJson<T>(path: string): Promise<T> {
  const content = await readText(path);
  return JSON.parse(content) as T;
}

async function readText(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf-8");
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
