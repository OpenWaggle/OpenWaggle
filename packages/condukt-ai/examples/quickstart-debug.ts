import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  Pipeline,
  type LLMJsonRequest,
  type LLMJsonResponse,
  type LLMProvider,
} from "../src/index.js";

type DemoModel = "demo-model";
type DemoModelSettingsByModel = {
  readonly "demo-model": Record<string, never>;
};

class DemoProvider implements LLMProvider<DemoModel, DemoModelSettingsByModel> {
  readonly name = "demo";
  readonly models = ["demo-model"] as const;

  constructor(private readonly broken: boolean) {}

  async generateJSON<TSelectedModel extends DemoModel>(
    request: LLMJsonRequest<TSelectedModel, DemoModelSettingsByModel[TSelectedModel]>,
  ): Promise<LLMJsonResponse<TSelectedModel>> {
    const data = this.resolvePrompt(request.prompt);
    return {
      provider: this.name,
      model: request.model,
      rawText: JSON.stringify(data),
      data,
    };
  }

  private resolvePrompt(prompt: string): unknown {
    if (prompt.startsWith("research:")) {
      return {
        topics: ["reusability", "turnaround", "cost"],
        sources: ["nasa", "spacex", "faa"],
      };
    }

    if (prompt.startsWith("draft:")) {
      if (this.broken) {
        return {
          article: "Reusable launch vehicles reduce launch costs.",
          claims: "this should be a list, not a string",
        };
      }

      return {
        article: "Reusable launch vehicles reduce launch costs and increase launch cadence.",
        claims: [
          "Falcon 9 first-stage boosters are reused.",
          "Turnaround time is a major cost driver.",
        ],
      };
    }

    if (prompt.startsWith("verify:")) {
      return {
        verified: true,
        issues: [],
      };
    }

    throw new Error(`unknown prompt: ${prompt}`);
  }
}

async function main(): Promise<void> {
  const broken = process.argv.includes("--broken");
  const provider = new DemoProvider(broken);

  const pipeline = new Pipeline("quickstart-research-write")
    .addLLMTask({
      id: "research",
      provider,
      model: "demo-model",
      output: z.object({
        topics: z.array(z.string()),
        sources: z.array(z.string()),
      }),
      prompt: () => "research:reusable-launch-vehicles",
    })
    .addLLMTask({
      id: "draft",
      after: ["research"] as const,
      provider,
      model: "demo-model",
      output: z.object({
        article: z.string(),
        claims: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const research = dependencyOutputs.research;
        return `draft:${research.topics.join(",")}`;
      },
    })
    .addLLMTask({
      id: "verify",
      after: ["draft"] as const,
      provider,
      model: "demo-model",
      output: z.object({
        verified: z.boolean(),
        issues: z.array(z.string()),
      }),
      prompt: ({ dependencyOutputs }) => {
        const draft = dependencyOutputs.draft;
        return `verify:${draft.claims.length}`;
      },
    });

  const trace = await pipeline.run();
  const outputPath = resolve(process.cwd(), "trace.quickstart.json");
  await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`, "utf-8");

  console.log(`Trace written to ${outputPath}`);
  console.log(`Status: ${trace.status}`);

  if (trace.status === "failed") {
    const failedTask = trace.tasks.find((task) => task.status === "error");
    if (failedTask) {
      console.log(`Failed task: ${failedTask.task}`);
      console.log(`Error code: ${failedTask.error_code}`);
      console.log(`Error: ${failedTask.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
