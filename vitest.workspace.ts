import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/tepa", "packages/tools", "packages/provider-core", "packages/provider-anthropic", "packages/provider-openai"]);
