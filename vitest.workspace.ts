import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/tepa", "packages/tools", "packages/provider-anthropic", "packages/provider-openai"]);
