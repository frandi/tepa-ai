# Examples and Demos

Tepa ships with three runnable demos in the `demos/` directory. Each is a standalone project that demonstrates a different pipeline behaviour — autonomous self-correction, single-cycle data analysis, and human-in-the-loop interaction. They're designed to be run, read, and adapted.

## Demo Map

| Demo | Use Case | Key Concepts |
|---|---|---|
| [API Client Generation](#api-client-generation) | Code generation with automated testing | Multi-cycle self-correction, structured `expectedOutput`, `shell_execute` |
| [Student Progress Analysis](#student-progress-analysis) | Data analysis and report generation | Single-cycle completion, reasoning steps, `scratchpad`, `data_parse` |
| [Study Plan Generator](#study-plan-generator) | Interactive, human-guided output | `postPlanner` approval gate, `postEvaluator` verdict override, async events |

If you're evaluating Tepa for a specific use case, the table above should point you to the most relevant demo. If you're new and just want to see the pipeline in action, start with the [API Client Generation](#api-client-generation) demo — it shows the full self-correction loop most clearly.

---

## Before You Run

All three demos live in the `demos/` directory of the repository. Prerequisites:

```bash
# 1. Clone the repo (if you haven't already)
git clone https://github.com/frandi/tepa-ai.git
cd tepa-ai

# 2. Install all dependencies from the root
npm install

# 3. Build all packages
npm run build

# 4. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...
```

All three demos use the Anthropic provider. Each demo directory has its own `run.sh` script — always use `run.sh` rather than `npm start` directly, because it cleans up any previously generated output files before running so the pipeline always starts from a clean state.

---

## API Client Generation

**Directory:** `demos/api-client-gen/`  
**Demonstrates:** Autonomous code generation, multi-cycle self-correction, verifiable test-based evaluation

This demo generates a typed TypeScript API client for the [JSONPlaceholder API](https://jsonplaceholder.typicode.com), writes tests, runs them, and self-corrects if they fail. It's fully autonomous — no human input after the initial run.

### What It Shows

This demo answers the question: *what does self-correction actually look like in practice?*

The success criterion isn't "did the agent generate code" — it's "do the tests pass." The Evaluator runs `npx vitest run` and checks the exit code. If the generated code compiles but fails tests (a common failure mode — the agent might use `new axios()` instead of `axios.create()` to match the existing project pattern), the Evaluator feeds back exactly what failed and the Planner produces a minimal revised plan. The pipeline fixes only what broke.

This is the clearest demonstration of the Plan-Execute-Evaluate loop in the codebase. See [How Tepa Works](./03-how-tepa-works.md) for the conceptual explanation and [Pipeline in Detail](./04-pipeline-in-detail.md) for the self-correction mechanics.

### What Happens

1. The Planner reads the prompt and produces a plan: explore the project structure, discover code style, probe API endpoints, generate types, generate the client, generate tests, run the tests
2. The Executor explores the mock project at `my-project/` and finds an `HttpClient` class in `src/utils/http.ts` that wraps `axios.create()`
3. It probes the JSONPlaceholder API to discover response shapes, then generates `src/api/types.ts`, `src/api/jsonplaceholder.ts`, and `src/api/__tests__/jsonplaceholder.test.ts`
4. It runs `npx vitest run` via `shell_execute` to verify the tests pass
5. The Evaluator checks whether all three files exist, follow the expected patterns, and all tests pass
6. If tests fail, the Evaluator's feedback guides the Planner to produce a minimal fix — typically just correcting the client initialisation

### Prompt

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

The `criteria` entries are what drive self-correction. The requirement that tests must pass when run with `npx vitest run` means the Evaluator doesn't just check if a test file exists — it verifies the code actually works. See [Pipeline in Detail — Structured expectedOutput](./04-pipeline-in-detail.md#structured-expectedoutput) for how criteria arrays affect evaluation.

### Tools

| Tool | Purpose |
|---|---|
| `file_read` | Read existing project files to discover code style |
| `file_write` | Write generated code files |
| `directory_list` | Explore the mock project structure |
| `file_search` | Find files matching patterns |
| `shell_execute` | Run `npx vitest run` to verify tests |
| `http_request` | Probe API endpoints to discover response shapes |

### Configuration

```typescript
const tepa = new Tepa({
  tools: [
    fileReadTool, fileWriteTool, directoryListTool,
    fileSearchTool, shellExecuteTool, httpRequestTool,
  ],
  provider: new AnthropicProvider(),
  config: {
    limits: {
      maxCycles: 3,       // Room for one attempt + two correction cycles
      maxTokens: 400_000, // Higher budget: code generation steps produce longer outputs
    },
    logging: { level: "verbose" },
  },
});
```

### Self-Correction in Action

The pipeline typically completes in 1–2 cycles:

- **Cycle 1** — Generates all three files. Tests may fail if the agent doesn't correctly follow the `axios.create()` pattern from `src/utils/http.ts`.
- **Cycle 2 (if needed)** — The Evaluator's feedback identifies exactly which test failed and why. The Planner produces a minimal revised plan — usually just fixing the client initialisation. Tests pass.

The key observation: cycle 2 doesn't re-generate everything. The Planner reads `_execution_summary` from the scratchpad, sees that types and tests were generated correctly, and produces a plan that only touches the client file. This is minimal revision, not a full restart.

### Running

```bash
cd demos/api-client-gen
./run.sh
```

---

## Student Progress Analysis

**Directory:** `demos/student-progress/`  
**Demonstrates:** Data pipeline, LLM reasoning steps, scratchpad state management, single-cycle completion

This demo analyses student grade and attendance data for a class, produces a comprehensive insight report, and exports a flagged-students summary. It demonstrates that the self-correction loop adds zero overhead when it isn't needed — a well-defined task with sufficient tools completes in a single cycle.

### What It Shows

This demo answers two questions: *how does Tepa handle multi-step data analysis?* and *does the pipeline add overhead when self-correction isn't needed?*

The answer to the second question is no — the pipeline runs one cycle and exits immediately when the Evaluator passes. There's no retry tax for tasks that are well-specified.

It also demonstrates **reasoning steps** — plan steps with an empty `tools` array where the LLM produces analysis as text rather than invoking a tool. Step 4 in the typical plan is a pure reasoning step: the LLM receives the computed metrics from prior steps and generates tailored recommendations for each at-risk student. No tools needed — just synthesis. See [How Tepa Works — The Planner](./03-how-tepa-works.md#the-planner) for the reasoning step concept.

### What Happens

1. The Planner produces a plan: read and parse CSVs, compute class metrics, identify at-risk students, correlate attendance with performance (reasoning step), write the report
2. The Executor reads `grades.csv` (1,344 rows — 28 students × 6 subjects × 8 assignments) and `attendance.csv` (1,764 rows — 28 students × 63 school days) using `data_parse`
3. It computes averages, pass rates, and per-subject trends — carrying intermediate results across steps via the `scratchpad` tool
4. A reasoning step synthesises findings and generates tailored recommendations for each flagged student — pure LLM reasoning, no tool calls
5. It writes `progress-report.md` and `flagged-students.csv` to the data directory
6. The Evaluator performs structural checks (files exist, correct CSV format) and qualitative checks (recommendations are specific, not generic) — passes on the first attempt

### Mock Data

The CSV files contain realistic data designed to produce meaningful analysis:

- **28 students** across **6 subjects** (Math, English, Science, History, Art, PE)
- **Class average:** ~72%, with Math declining and Art/English improving
- **5 at-risk students** with distinct patterns: multi-subject failure + chronic absence (Liam Chen, ~54%), isolated Math failure despite strong attendance (Jake Thompson, ~63%), sharpest attendance decline (Aisha Patel, ~67%), and two others
- **Strong attendance-performance correlation** (~0.73) — the report surfaces this automatically
- **One improvement story** — Noah Kim (61% → 73.5%) provides a positive data point

### Prompt

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

Notice the `notes` field in context — *"Parent-teacher conferences are scheduled for next week"* is domain context that informs the Evaluator's qualitative check. The Evaluator can assess whether the recommendations are appropriately timely and actionable for that context, not just formally complete.

### Tools

| Tool | Purpose |
|---|---|
| `file_read` | Read CSV data files |
| `file_write` | Write report and flagged students CSV |
| `directory_list` | Explore the data directory |
| `data_parse` | Parse CSV into structured row objects |
| `shell_execute` | Run data processing scripts if needed |
| `scratchpad` | Carry computed metrics between steps |
| `log_observe` | Record analytical observations to the pipeline log |

The scratchpad is essential in this demo — the Executor computes averages and pass rates in one step, then reads them back in a later reasoning step that generates recommendations. Without the scratchpad, each step would only have access to its declared dependencies' direct output.

### Configuration

```typescript
const tepa = new Tepa({
  tools: [
    fileReadTool, fileWriteTool, directoryListTool,
    dataParseTool, shellExecuteTool, scratchpadTool, logObserveTool,
  ],
  provider: new AnthropicProvider(),
  config: {
    limits: {
      maxCycles: 3,       // Allowed, but typically completes in 1
      maxTokens: 250_000, // Lower budget sufficient — no code generation
    },
    logging: { level: "verbose" },
  },
});
```

### Running

```bash
cd demos/student-progress
./run.sh
```

---

## Study Plan Generator

**Directory:** `demos/study-plan/`  
**Demonstrates:** Human-in-the-loop interaction, async event callbacks, plan approval, verdict override

This demo shows Tepa's event system used for inserting human decision points into the pipeline. The user provides a learning goal, reviews the generated plan before execution begins, and can accept or reject results after evaluation. No part of the pipeline runs without the user's explicit approval at each checkpoint.

### What It Shows

This demo answers the question: *how do you put a human in control of an autonomous pipeline?*

The mechanism is two async event callbacks — one that pauses after planning, one that pauses after evaluation. Because event callbacks can return Promises, the pipeline waits at each checkpoint until the user responds. The pipeline doesn't know or care that it's paused for human input — from its perspective, a callback returned a Promise that eventually resolved. See [Event System Patterns — Human-in-the-Loop](./07-event-system-patterns.md#human-in-the-loop-plan-approval) for the full pattern documentation.

### Interactive Flow

Here's what a typical run looks like:

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
Status: pass | Cycles: 1 | Tokens: 12,400
```

If the Evaluator returns `fail`, the user gets to decide whether to retry or accept:

```
--- Evaluation: FAIL (confidence: 0.45) ---
  Feedback: Missing time estimates for weeks 3-4. Resources are too generic.

Continue with another cycle to improve? (yes/no): no
  [User override] Accepting current results.

=== Result ===
Status: pass | Cycles: 1 | Tokens: 11,200
```

Notice the result: `Status: pass` even though the Evaluator returned `fail`. The `postEvaluator` callback flipped the verdict to `"pass"` when the user declined to retry — the pipeline treats a user-overridden verdict identically to a genuine evaluator pass.

### What Happens

1. The entry script prompts the user for a learning goal and injects it into the prompt context
2. The Planner generates a plan for producing the study plan
3. **Pipeline pauses** — `postPlanner` callback displays the plan and awaits user approval
4. After approval, the Executor writes a detailed study plan to `study-plan.md`
5. The Evaluator checks quality criteria: weekly breakdowns, concrete resources, time estimates
6. **If `fail`** — `postEvaluator` callback asks the user whether to run another cycle or accept the results
7. If the user accepts, the verdict is overridden to `"pass"` and the pipeline exits

### The Event Callbacks

**Plan approval gate — `postPlanner`:**

```typescript
events: {
  postPlanner: [
    async (data: unknown) => {
      const plan = data as Plan;

      console.log(`\n--- Plan (${plan.steps.length} steps) ---`);
      for (const step of plan.steps) {
        const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
        console.log(`  ${step.id}: ${step.description} (${tools})`);
      }

      const answer = await ask("\nDo you approve this plan? (yes/no): ");
      if (answer !== "yes" && answer !== "y") {
        throw new Error("Plan rejected by user");
      }
      // Returning void — original plan passes through unchanged
    },
  ],
}
```

The callback is `async` and awaits the user's response. The pipeline waits on this Promise. Throwing rejects the plan and aborts the pipeline. Returning nothing approves it as-is.

**Verdict override — `postEvaluator`:**

```typescript
postEvaluator: [
  async (data: unknown) => {
    const result = data as EvaluationResult;

    if (result.verdict === "fail") {
      const answer = await ask("Continue with another cycle to improve? (yes/no): ");
      if (answer !== "yes" && answer !== "y") {
        console.log("  [User override] Accepting current results.\n");
        return { ...result, verdict: "pass" as const }; // Flips the verdict
      }
    }
    // Returning void — original verdict passes through, pipeline continues to next cycle
  },
],
```

Returning a modified `EvaluationResult` with `verdict: "pass"` stops the re-planning loop. The pipeline checks the verdict after all `postEvaluator` callbacks complete — a flipped verdict is treated identically to a genuine evaluator pass.

### Prompt

The prompt uses a placeholder that gets injected at runtime:

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

The entry script injects the user's input before running:

```typescript
const userInput = await rl.question("What would you like to study?\n> ");
prompt.context.userInput = userInput;
```

### Tools

| Tool | Purpose |
|---|---|
| `file_read` | Read existing files in the output directory |
| `file_write` | Write the study plan to `study-plan.md` |
| `directory_list` | Explore the output directory |
| `scratchpad` | Carry research notes and outline between steps |

This demo uses the fewest tools — it's primarily an LLM reasoning task. The scratchpad carries research findings from early steps into the final writing step without requiring an explicit dependency chain on the raw tool outputs.

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

### Running

```bash
cd demos/study-plan
./run.sh
```

---

## Shared Observability Pattern

All three demos register the same three event hooks for pipeline visibility. These aren't required — the pipeline runs identically without them — but they represent a useful baseline for any Tepa integration. Add them when you need to see what's happening; strip them for a clean production run.

**`postPlanner`** — Print the generated plan as a step list:

```typescript
postPlanner: [(data: unknown) => {
  const plan = data as Plan;
  for (const step of plan.steps) {
    const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
    const deps = step.dependencies.length > 0 ? ` ← ${step.dependencies.join(", ")}` : "";
    console.log(`  ${step.id}: ${step.description} (${tools})${deps}`);
  }
}],
```

**`postStep`** — Log each step's result with token and timing data:

```typescript
postStep: [(data: unknown) => {
  const { step, result } = data as PostStepPayload;
  const icon = result.status === "success" ? "OK" : "FAIL";
  console.log(`  ${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)`);
  if (result.error) console.log(`    → ${result.error}`);
}],
```

**`postEvaluator`** — Print the verdict with confidence score and feedback:

```typescript
postEvaluator: [(data: unknown) => {
  const result = data as EvaluationResult;
  const icon = result.verdict === "pass" ? "PASS" : "FAIL";
  console.log(`--- Evaluation: ${icon} (confidence: ${result.confidence.toFixed(2)}) ---`);
  if (result.verdict === "pass" && result.summary) console.log(`  Summary: ${result.summary}`);
  if (result.verdict === "fail" && result.feedback) console.log(`  Feedback: ${result.feedback}`);
}],
```

These three hooks cover the three moments developers most want visibility into: *what is the agent about to do?* (plan), *how did each step go?* (step), and *did it work?* (evaluation). For the full patterns — adding human approval gates, safety filters, monitoring integration — see [Event System Patterns](./07-event-system-patterns.md).

---

## What's Next

- [**API Reference**](./11-api-reference.md) — Complete interface definitions for everything used in these demos.
- [**Configuration**](./05-configuration.md) — Tune cycle limits, token budgets, and per-stage models for your use case.
- [**Event System Patterns**](./07-event-system-patterns.md) — Extend the observability hooks above into full human-in-the-loop workflows, safety filters, and monitoring integrations.
- [**Contributing**](./10-contributing.md) — Add your own demo, tool, or provider to the repository.
