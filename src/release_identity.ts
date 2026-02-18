export interface ReleaseIdentityInputs {
  readonly packageName: string;
  readonly repositoryUrl: string;
  readonly homepageUrl: string;
  readonly bugsUrl: string;
  readonly readme: string;
  readonly publishingDoc: string;
  readonly trialsDoc: string;
  readonly traceWalkthroughDoc: string;
}

export function validateReleaseIdentity(inputs: ReleaseIdentityInputs): readonly string[] {
  const errors: string[] = [];

  if (inputs.packageName !== "condukt-ai") {
    errors.push(`package name must be condukt-ai (found: ${inputs.packageName})`);
  }

  if (!inputs.repositoryUrl.includes("condukt-ai")) {
    errors.push("repository url must include condukt-ai");
  }

  if (!inputs.homepageUrl.includes("condukt-ai")) {
    errors.push("homepage url must include condukt-ai");
  }

  if (!inputs.bugsUrl.includes("condukt-ai")) {
    errors.push("bugs url must include condukt-ai");
  }

  if (!inputs.readme.includes("pnpm add condukt-ai zod")) {
    errors.push("core README must include `pnpm add condukt-ai zod` install snippet");
  }

  if (inputs.readme.includes('from "condukt"') || inputs.readme.includes("pnpm add condukt zod")) {
    errors.push("core README contains legacy `condukt` package reference");
  }

  if (!inputs.homepageUrl.includes("/tree/main/packages/core")) {
    errors.push("homepage url must include /tree/main/packages/core");
  }

  if (!inputs.publishingDoc.includes("pnpm npm view condukt-ai")) {
    errors.push("publishing doc must verify condukt-ai package availability");
  }

  if (!inputs.publishingDoc.includes("import('condukt-ai')")) {
    errors.push("publishing doc must verify `condukt-ai` import");
  }

  if (!inputs.trialsDoc.includes("mode (`baseline` or `condukt-ai`)")) {
    errors.push("trials doc must reference canonical `condukt-ai` mode");
  }

  if (!inputs.traceWalkthroughDoc.includes("--mode condukt-ai")) {
    errors.push("trace walkthrough must use `--mode condukt-ai`");
  }

  return errors;
}
