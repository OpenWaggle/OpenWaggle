import type { AnyTextAdapter } from "@tanstack/ai";
import { z } from "zod";

import { tanstackChatTask } from "../src/index.js";

const adapter = {
  kind: "text",
  name: "typecheck-adapter",
  model: "typecheck-model",
} as unknown as AnyTextAdapter;

tanstackChatTask({
  id: "tanstack-valid",
  adapter,
  output: z.object({ ok: z.boolean() }),
  options: {
    temperature: 0.2,
    maxTokens: 120,
    metadata: {
      source: "typecheck",
    },
  },
  prompt: () => '{"ok":true}',
});

tanstackChatTask({
  id: "tanstack-invalid-option",
  adapter,
  output: z.object({ ok: z.boolean() }),
  options: {
    // @ts-expect-error unknown option key
    unknownOption: true,
  },
  prompt: () => '{"ok":true}',
});
