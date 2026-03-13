# Examples and Demos

Tepa ships with three demos that showcase different pipeline behaviors — autonomous multi-cycle self-correction, single-cycle data analysis, and human-in-the-loop interaction. Each demo is a standalone project in the `demos/` directory with its own prompt file, entry script, and mock data. This section walks through what each demo does, how it's configured, and what it demonstrates about the pipeline.

All three demos use the Anthropic provider and share the same event hook pattern for visualizing plans, steps, and evaluations. The differences are in the tools, prompt structure, and event-driven control flow.

## API Client Generation

**Directory:** `demos/api-client-gen/`
**Demonstrates:** Autonomous code generation, test execution, multi-cycle self-correction

This demo generates a typed TypeScript API client for the [JSONPlaceholder API](https://jsonplaceholder.typicode.com), writes tests, runs them, and self-corrects if the tests fail. It's a fully autonomous pipeline — no human input after the initial run.

### What Happens

1. The Planner reads the prompt and produces a plan: explore the project, discover the existing code style, generate types, generate the client, generate tests, run the tests
2. The Executor explores the mock project at `my-project/` and discovers an `HttpClient` class in `src/utils/http.ts` that wraps `axios.create()`
3. It probes the JSONPlaceholder API endpoints to discover response shapes, then generates `src/api/types.ts`, `src/api/jsonplaceholder.ts`, and `src/api/__tests__/jsonplaceholder.test.ts`
4. It runs `npx vitest run` via `shell_execute` to verify the tests
5. The Evaluator checks whether the generated files exist, follow the expected patterns, and the tests pass
6. If tests fail (e.g., the agent used `new axios()` instead of `axios.create()` matching the project pattern), the Evaluator feeds back the failure and the pipeline re-plans a minimal fix

### Prompt

The prompt file (`prompts/task.yaml`) defines a goal with rich context — the existing project structure, target structure, language, HTTP client, and test framework:

```yaml
goal: >
  Create a TypeScript API client module for the JSONPlaceholder API
  (https://jsonplaceholder.typicode.com).
  All file paths are relative to the projectRoot directory specified in context.

context:
  projectRoot: ./my-project
  language: TypeScript
  runtime: Node.js
  httpClient: axios
  testFramework: vitest
  existingStructure: |
    my-project/
    └── src/
        └── utils/
            └── http.ts          # HttpClient class wrapping axios.create()

expectedOutput:
  - path: src/api/jsonplaceholder.ts
    description: A typed API client class with methods for posts, users, and comments
    criteria:
      - Uses axios.create() with baseURL following existing project patterns
      - Methods are fully typed with return types
      - Exports a default client instance
  - path: src/api/types.ts
    description: TypeScript type definitions for API response shapes
  - path: src/api/__tests__/jsonplaceholder.test.ts
    description: Test file using vitest
    criteria:
      - All tests passing when run with npx vitest run
```

The `expectedOutput` criteria are what the Evaluator checks against. The requirement that tests must pass when run with `npx vitest run` is what drives self-correction — if the Executor generates code that compiles but fails tests, the Evaluator will return `fail` with specific feedback about what went wrong.

### Tools

This demo uses six tools:

| Tool             | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `file_read`      | Read existing project files to discover code style |
| `file_write`     | Write generated code files                         |
| `directory_list` | Explore the mock project structure                 |
| `file_search`    | Find files matching patterns                       |
| `shell_execute`  | Run `npx vitest run` to verify tests               |
| `http_request`   | Probe API endpoints to discover response shapes    |

### Configuration

```typescript
const tepa = new Tepa({
  tools: [
    fileReadTool,
    fileWriteTool,
    directoryListTool,
    fileSearchTool,
    shellExecuteTool,
    httpRequestTool,
  ],
  provider: new AnthropicProvider(),
  config: {
    limits: {
      maxCycles: 3,
      maxTokens: 400_000,
    },
    logging: { level: "verbose" },
  },
});
```

The `maxCycles: 3` gives the pipeline room for one initial attempt plus two correction cycles. The higher token budget (`400_000`) accounts for the multi-step nature of code generation — the Executor makes multiple LLM calls per cycle (one per plan step), and code generation steps tend to produce longer outputs.

### Self-Correction in Action

The pipeline typically completes in 1–2 cycles:

- **Cycle 1:** Generates all files. Tests may fail if the agent doesn't correctly follow the `axios.create()` pattern from `src/utils/http.ts`.
- **Cycle 2 (if needed):** The Evaluator's feedback guides the Planner to produce a minimal revised plan — usually just fixing the client initialization. Tests pass.

This is the key value of the Plan-Execute-Evaluate loop: the pipeline doesn't just generate code and hope — it verifies the output against concrete criteria and fixes what's broken.

### Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd demos/api-client-gen
./run.sh
```

Use `run.sh` instead of `npm start` directly — it removes `my-project/src/api/` (the generated output directory) before starting, so the pipeline always begins from a clean state.

## Student Progress Analysis

**Directory:** `demos/student-progress/`
**Demonstrates:** Data pipeline, CSV parsing, LLM reasoning steps, single-cycle completion

This demo analyzes student grade and attendance data for a class, produces a comprehensive insight report, and exports a flagged students summary. It demonstrates that the pipeline loop isn't always multi-cycle — when the task is well-defined and the tools are sufficient, a single cycle is enough.

### What Happens

1. The Planner produces a plan to read and parse CSVs, compute metrics, identify at-risk students, correlate attendance with performance, and write the report
2. The Executor reads `grades.csv` (1,344 rows — 28 students × 6 subjects × 8 assignments) and `attendance.csv` (1,764 rows — 28 students × 63 school days) using `data_parse` to convert them to structured data
3. It computes class-wide averages, pass rates, and per-subject trends — carrying intermediate results across steps via the `scratchpad` tool
4. A reasoning step (no tools — pure LLM) generates tailored recommendations for each at-risk student
5. It writes `progress-report.md` and `flagged-students.csv` to the data directory
6. The Evaluator performs structural checks (files exist, correct CSV format) and qualitative checks (recommendations are specific, not generic)

### Prompt

The prompt file provides domain-specific context — grading thresholds, column definitions, and a note about upcoming parent-teacher conferences:

```yaml
goal: >
  Analyze student learning progress for Class 5B (Fall 2025 semester)
  and produce an insight report with actionable recommendations.

context:
  classDir: ./class-5b
  gradeFile: grades.csv
  attendanceFile: attendance.csv
  gradeFileColumns: student_name, subject, assignment_name, score, max_score, date
  attendanceFileColumns: student_name, date, status
  studentCount: 28
  subjectCount: 6
  gradingPolicy:
    failing: 60
    intervention: 70
  notes:
    - Parent-teacher conferences are scheduled for next week
    - Below 60% is failing, below 70% needs intervention

expectedOutput:
  - path: ./class-5b/progress-report.md
    description: A comprehensive progress report
    criteria:
      - Class-wide performance overview with averages and pass rates
      - Per-subject trend analysis identifying improving and declining subjects
      - Individual student flags for at-risk students
      - Correlation between attendance and performance
      - Actionable recommendations for each flagged student
  - path: ./class-5b/flagged-students.csv
    description: Summary CSV of at-risk students for quick reference
    criteria:
      - Columns include student name, overall percentage, urgency level, attendance rate, primary concern
```

The `gradingPolicy` context gives the pipeline concrete thresholds to work with. The `notes` about parent-teacher conferences inform the Evaluator — it can check whether recommendations are timely and actionable for that context.

### Mock Data

The CSV files contain realistic data designed to produce meaningful analysis:

- **28 students** across **6 subjects** (Math, English, Science, History, Art, PE)
- **Class average:** ~72%, with Math declining and Art/English improving
- **5 at-risk students** with distinct patterns:
  - Liam Chen (~54%) — multi-subject failure + chronic absence
  - Sofia Rodriguez (~58%) — failing Math and Science
  - Jake Thompson (~63%) — isolated Math failure despite good attendance
  - Aisha Patel (~67%) — sharpest decline, absences increasing monthly
  - Marcus Williams (~69%) — Math below threshold, rest adequate
- **Strong attendance-performance correlation** (~0.73)
- Noah Kim as an improvement story (61% → 73.5%)

### Tools

| Tool             | Purpose                               |
| ---------------- | ------------------------------------- |
| `file_read`      | Read CSV data files                   |
| `file_write`     | Write report and flagged students CSV |
| `directory_list` | Explore the data directory            |
| `data_parse`     | Parse CSV into structured data        |
| `shell_execute`  | Run data analysis scripts             |
| `scratchpad`     | Carry computed metrics across steps   |
| `log_observe`    | Record analytical observations        |

This is the only demo that uses `data_parse` (for CSV processing) and `scratchpad` (for carrying intermediate computed metrics between steps). The scratchpad is essential here — the Executor computes averages and pass rates in one step, then reads them back in a later step that generates recommendations.

### Configuration

```typescript
const tepa = new Tepa({
  tools: [
    fileReadTool,
    fileWriteTool,
    directoryListTool,
    dataParseTool,
    shellExecuteTool,
    scratchpadTool,
    logObserveTool,
  ],
  provider: new AnthropicProvider(),
  config: {
    limits: {
      maxCycles: 3,
      maxTokens: 250_000,
    },
    logging: { level: "verbose" },
  },
});
```

A lower token budget (`250_000`) is sufficient because this task doesn't involve code generation or test execution — the LLM calls are shorter.

### Single-Cycle Completion

This demo typically completes in a **single cycle**. The task is well-constrained — the data exists, the expected output format is clear, and the tools provide everything the Executor needs. The Evaluator checks that the report covers all five criteria and that the CSV has the right columns, and passes on the first attempt.

This demonstrates that the self-correction loop adds zero overhead when it isn't needed — the pipeline runs one cycle and exits.

### Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd demos/student-progress
./run.sh
```

Use `run.sh` instead of `npm start` directly — it removes any previously generated `progress-report.md` and `flagged-students.csv` from the `class-5b/` directory before starting.

## Study Plan Generator

**Directory:** `demos/study-plan/`
**Demonstrates:** Human-in-the-loop interaction, plan approval gates, verdict override

This demo showcases Tepa's event system for inserting human checkpoints into the pipeline. The user provides a learning goal, reviews and approves the generated plan, and decides whether to accept results or request another improvement cycle.

### What Happens

1. The demo prompts the user for a learning goal (e.g., "Learn Rust programming")
2. The Planner generates a structured plan for creating the study plan
3. **The pipeline pauses** — the `postPlanner` event displays the plan and asks the user to approve it
4. After approval, the Executor writes a detailed study plan to `study-plan.md`
5. The Evaluator checks the output against quality criteria (weekly breakdowns, concrete resources, time estimates)
6. **If the Evaluator fails, the pipeline pauses again** — the `postEvaluator` event asks the user whether to run another improvement cycle or accept the current results

### Human-in-the-Loop via Events

This is the key pattern. Two async event callbacks insert human decision points into the pipeline:

**Plan approval gate (`postPlanner`):**

```typescript
events: {
  postPlanner: [
    async (data: unknown) => {
      const plan = data as Plan;

      // Display the plan with dependency tree
      console.log(`\n--- Plan (${plan.steps.length} steps) ---`);
      for (const step of plan.steps) {
        console.log(`  ${step.id}: ${step.description}`);
      }

      // Pause for human approval
      const answer = await ask("\nDo you approve this plan? (yes/no): ");
      if (answer !== "yes" && answer !== "y") {
        console.log("  [Note] Plan revision is not yet supported. Continuing.\n");
      }
    },
  ],
}
```

The `postPlanner` callback is `async` — it returns a Promise that resolves when the user responds. The pipeline waits on this Promise before moving to execution. This is the same mechanism described in [Event System Patterns](./07-event-system-patterns.md) — any event callback can return a Promise to pause the pipeline.

**Verdict override (`postEvaluator`):**

```typescript
postEvaluator: [
  async (data: unknown) => {
    const result = data as EvaluationResult;

    if (result.verdict === "fail") {
      const answer = await ask("Continue with another cycle to improve? (yes/no): ");
      if (answer !== "yes" && answer !== "y") {
        console.log("  [User override] Accepting current results.\n");
        return { ...result, verdict: "pass" as const };
      }
    }
  },
],
```

When the Evaluator returns `fail`, the callback asks the user whether to continue. If the user declines, the callback **returns a modified result** with `verdict: "pass"`, overriding the Evaluator's decision. This is what makes the event system powerful — callbacks can transform the data flowing through the pipeline, not just observe it.

### Prompt

The prompt file uses a placeholder for user input that gets injected at runtime:

```yaml
goal: >
  Create a personalized study plan based on the user's learning goal.
  Write the complete study plan to the file specified in context.outputFile.

context:
  outputDir: .
  outputFile: ./study-plan.md
  userInput: "{{USER_INPUT}}"
  planFormat: |
    Structure as Markdown with:
    - Title and overview
    - Weekly breakdowns (topics, resources, exercises, time estimates)
    - Tips for staying on track

expectedOutput:
  - path: ./study-plan.md
    description: A comprehensive personalized study plan
    criteria:
      - Clear title reflecting the user's goal
      - Weekly breakdowns with specific topics
      - Concrete learning resources (books, courses, websites)
      - Practice exercises or projects per week
      - Estimated time commitments
```

The entry script injects the user's input into the prompt before running:

```typescript
const userInput = await rl.question("What would you like to study?\n> ");
prompt.context.userInput = userInput;
```

### Tools

| Tool             | Purpose                                 |
| ---------------- | --------------------------------------- |
| `file_read`      | Read existing files                     |
| `file_write`     | Write the study plan to `study-plan.md` |
| `directory_list` | Explore the output directory            |
| `scratchpad`     | Carry state across execution steps      |

This demo uses the fewest tools — it's primarily an LLM reasoning task with file output. The scratchpad lets the Executor carry research and outline notes from earlier steps into the final writing step.

### Configuration

```typescript
const tepa = new Tepa({
  tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
  provider: new AnthropicProvider(),
  config: {
    limits: {
      maxCycles: 3,
      maxTokens: 250_000,
    },
    logging: { level: "verbose" },
  },
});
```

### Interactive Flow

A typical run looks like this:

```
=== Tepa Demo: Study Plan (Human-in-the-Loop) ===

What would you like to study?
> Learn Rust programming

--- Plan (4 steps) ---
  research: Research Rust learning resources (LLM reasoning)
  outline: Create study plan outline (scratchpad)
  write: Write detailed study plan (file_write)
  review: Review and finalize (file_read)

Do you approve this plan? (yes/no): yes

  research: OK — Research Rust learning resources (2140 tok, 3200ms)
  outline: OK — Create study plan outline (1800 tok, 2100ms)
  write: OK — Write detailed study plan (3200 tok, 4500ms)
  review: OK — Review and finalize (1100 tok, 1800ms)

--- Evaluation: PASS (confidence: 0.85) ---
  Summary: Study plan covers all criteria with specific weekly topics and resources.

=== Result ===
Status: pass
Cycles: 1
Tokens used: 12400
```

If the Evaluator had returned `fail`, the user would see:

```
--- Evaluation: FAIL (confidence: 0.45) ---
  Feedback: Missing time estimates for weeks 3-4. Resources are too generic.

Continue with another cycle to improve? (yes/no): no
  [User override] Accepting current results.
```

### Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd demos/study-plan
./run.sh
```

Use `run.sh` instead of `npm start` directly — it removes any previously generated `study-plan.md` before starting.

## Shared Event Pattern

All three demos use the same event hooks for visualization. These aren't required for the pipeline to work — they're convenience hooks that make the demo output readable:

**`postPlanner`** — Prints the plan as a dependency tree:

```typescript
postPlanner: [(data: unknown) => {
  const plan = data as Plan;
  for (const step of plan.steps) {
    const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
    const deps = step.dependencies.length > 0 ? ` <- ${step.dependencies.join(", ")}` : "";
    console.log(`  ${step.id}: ${step.description} (${tools})${deps}`);
  }
}],
```

**`postStep`** — Logs each step's result with status, token usage, and duration:

```typescript
postStep: [(data: unknown) => {
  const { step, result } = data as PostStepPayload;
  const icon = result.status === "success" ? "OK" : "FAIL";
  console.log(`  ${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)`);
}],
```

**`postEvaluator`** — Prints the verdict with confidence and feedback:

```typescript
postEvaluator: [(data: unknown) => {
  const result = data as EvaluationResult;
  const icon = result.verdict === "pass" ? "PASS" : "FAIL";
  console.log(`--- Evaluation: ${icon} (confidence: ${result.confidence}) ---`);
  if (result.feedback) console.log(`  Feedback: ${result.feedback}`);
}],
```

This pattern is a good starting point for any Tepa integration — register event hooks for the visibility you need, and add async callbacks when you need human control.

## What's Next

- [**Contributing**](./10-contributing.md) — Development setup, code conventions, and how to add new tools or providers.
