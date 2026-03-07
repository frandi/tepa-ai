# Demo: API Client Generation

This demo simulates **Scenario A** from the requirements document. Tepa autonomously generates a typed TypeScript API client for the [JSONPlaceholder API](https://jsonplaceholder.typicode.com), writes tests, runs them, and self-corrects if they fail.

## What It Does

1. **Explores** the mock project structure and discovers the existing code style (`src/utils/http.ts` uses `axios.create()`)
2. **Generates** TypeScript type definitions (`src/api/types.ts`) based on API response shapes
3. **Generates** a typed API client class (`src/api/jsonplaceholder.ts`) following the project's patterns
4. **Generates** a test file (`src/api/__tests__/jsonplaceholder.test.ts`) using vitest
5. **Runs** the test suite and evaluates results
6. **Self-corrects** if tests fail (e.g., fixing axios initialization to match the project pattern)

## Project Structure

```
demos/api-client-gen/
├── src/
│   └── index.ts              # Entry script — configures and runs Tepa
├── prompts/
│   └── task.yaml             # Prompt defining the goal and expected output
├── my-project/               # Mock project directory (pre-existing code)
│   ├── src/
│   │   └── utils/
│   │       └── http.ts       # Existing HTTP utility with axios.create() pattern
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
└── package.json
```

## Tools Used

- `file_read` — Read existing project files to discover code style
- `file_write` — Write generated code files
- `directory_list` — Explore project structure
- `file_search` — Find files matching patterns
- `shell_execute` — Run `npx vitest run` to verify tests
- `http_request` — Probe API endpoints to discover response shapes

## Running

Requires an `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd demos/api-client-gen
npm start
```

Or from the repo root:

```bash
npm start --workspace=@tepa/demo-api-client-gen
```

## Expected Behavior

The pipeline typically completes in 1–2 cycles:

- **Cycle 1**: Generates all files. Tests may fail if the agent doesn't correctly follow the `axios.create()` pattern.
- **Cycle 2** (if needed): Evaluator feedback guides the planner to produce a minimal fix. Tests pass.

Event hooks log the plan summary and evaluation verdict at each cycle.
