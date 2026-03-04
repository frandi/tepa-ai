# Tepa — Requirements Document

> *Tepa* — from Javanese *tepa slira*: the practice of self-reflection, measuring oneself against a standard before acting. An agent that doesn't just execute, but reflects, evaluates, and refines.

## 1. Overview

**Tepa** is a reusable library/framework that enables fully autonomous task execution through a cyclic loop of three core components: **Planner**, **Executor**, and **Evaluator**. Once an initial prompt is submitted, the pipeline operates without human intervention — planning how to approach the task, executing the plan using available tools, evaluating the results, and self-correcting until the desired output is achieved or operational limits are reached.

The framework is designed to be technology-agnostic, extensible, and configurable. Developers integrate it into their own projects by providing a prompt, registering tools, and setting configuration parameters. Tepa handles the rest.

---

## 2. Core Components

### 2.1 Planner

The Planner is the strategic brain of the pipeline. It receives the initial prompt (or feedback from a previous evaluation cycle) and produces a structured, step-by-step plan.

**Responsibilities:**

- Parse the initial prompt to understand the goal, context, and expected output.
- Break the goal down into discrete, ordered steps that the Executor can act on.
- Assign appropriate tools to each step based on the available tool registry.
- Estimate resource usage (token budget, expected cycles) for the plan.
- On subsequent cycles, receive evaluator feedback and produce a *minimal revised plan* — fixing only what failed rather than regenerating the entire plan from scratch.

**Inputs:**

- Initial prompt (first cycle) or evaluator feedback (subsequent cycles).
- Tool registry (list of available tools with their schemas).
- Configuration constraints (token budget, max cycles).
- Scratchpad contents from previous steps (if any).

**Outputs:**

- An ordered list of plan steps, each containing: a description of what to do, which tool(s) to use, and the expected outcome.

### 2.2 Executor

The Executor is the operational engine. It takes the plan and carries out each step sequentially, interacting with the real world through tools.

**Responsibilities:**

- Execute each plan step by invoking the specified tool(s) with the correct parameters.
- Capture and store results from each step (in the scratchpad or as direct output).
- Handle tool failures gracefully — capture errors and surface them for evaluation.
- Track resource consumption (tokens used, time elapsed) as execution progresses.
- Support both tool-based steps and pure LLM reasoning steps (where no tool is needed).

**Inputs:**

- The plan (list of steps from the Planner).
- Tool registry (to invoke tools).
- Scratchpad (to read/write intermediate state).

**Outputs:**

- Results for each step (success or failure with details).
- Updated scratchpad with intermediate data.
- Accumulated resource usage metrics.

### 2.3 Evaluator

The Evaluator is the quality gate. It inspects the Executor's results against the original goal and expected output criteria, then decides whether the pipeline should terminate or loop back.

**Responsibilities:**

- Compare the Executor's output against the expected output defined in the initial prompt.
- Perform both structural checks (do the expected files exist? are the right fields present?) and qualitative checks (is the content meaningful? are recommendations actionable?).
- Produce a clear verdict: **PASS** or **FAIL**.
- On failure, generate specific, actionable feedback describing what went wrong and what needs to change — this feedback is sent to the Planner for the next cycle.
- Enforce termination conditions: pass the configured maximum cycle limit or token budget, even if the task isn't complete.

**Inputs:**

- Executor results (outputs from all steps).
- Original prompt (to compare against expected output).
- Scratchpad contents.
- Resource usage metrics.

**Outputs:**

- Verdict: PASS or FAIL.
- On PASS: final output summary returned to the caller.
- On FAIL: structured feedback describing what failed and suggested corrections.

---

## 3. Pipeline Flow

The pipeline follows a cyclic flow that repeats until the Evaluator issues a PASS verdict or a termination condition is reached.

```
                    ┌──────────────────────────────────────────┐
                    │            Initial Prompt                │
                    │  (goal + context + expected output)       │
                    └──────────────────┬───────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                 ┌───────────►│    PLANNER       │
                 │            │                  │
                 │            │  Produces a      │
                 │            │  step-by-step    │
                 │            │  plan            │
                 │            └────────┬─────────┘
                 │                     │
                 │                     ▼
                 │            ┌─────────────────┐
                 │            │    EXECUTOR      │
                 │            │                  │
                 │            │  Runs each step  │
                 │            │  using tools     │
                 │            └────────┬─────────┘
                 │                     │
                 │                     ▼
                 │            ┌─────────────────┐
                 │            │   EVALUATOR      │
                 │            │                  │
                 │            │  Checks results  │
                 │            │  against goal    │
                 │            └────────┬─────────┘
                 │                     │
                 │              ┌──────┴──────┐
                 │              │             │
                 │            FAIL          PASS
                 │              │             │
                 │              ▼             ▼
                 │        ┌──────────┐  ┌──────────────┐
                 └────────┤ Feedback │  │ Final Output │
                          └──────────┘  └──────────────┘
```

**Step-by-step flow:**

1. The caller submits an **initial prompt** containing the goal, supporting context, and a description of the expected output.
2. The **Planner** analyzes the prompt and the available tools, then produces an ordered plan.
3. The **Executor** carries out each step in the plan, invoking tools and recording results.
4. The **Evaluator** inspects the results against the expected output criteria.
5. If the Evaluator issues a **PASS**, the pipeline terminates and returns the final output to the caller.
6. If the Evaluator issues a **FAIL**, it generates structured feedback. The pipeline checks termination conditions (max cycles, token budget). If limits are not exceeded, the feedback is sent back to the Planner for a new cycle. If limits are exceeded, the pipeline terminates with a partial result and failure report.

---

## 4. Tool System

Tools are the mechanism by which the Executor interacts with the outside world. The pipeline itself is tool-agnostic — it relies on a **tool registry** where developers register the tools available for a given task.

### 4.1 Tool Registry

Every tool is registered with a schema that includes:

- **Name**: unique identifier (e.g., `file_read`, `http_request`).
- **Description**: human-readable explanation of what the tool does (used by the Planner to reason about tool selection).
- **Input parameters**: typed parameter definitions with descriptions.
- **Output format**: description of what the tool returns.

The registry is extensible. Developers can register custom tools alongside the built-in set.

### 4.2 Initial Tool Set

The following tools are included as the default set for the initial implementation:

**File System**

- `file_read` — Read the contents of a file at a given path.
- `file_write` — Write content to a file at a given path (create or overwrite).
- `directory_list` — List files and subdirectories at a given path, with optional recursive traversal.
- `file_search` — Find files matching a glob pattern or name filter within a directory tree.

**Process Execution**

- `shell_execute` — Run a shell command, capturing stdout, stderr, and exit code. Supports configurable timeout and working directory.

**Network**

- `http_request` — Make an HTTP request (GET, POST, PUT, DELETE) with configurable URL, headers, query parameters, and body. Returns status code, headers, and response body.
- `web_search` — Perform a web search query and return a list of results with titles, URLs, and snippets.

**Data Processing**

- `data_parse` — Parse structured data (JSON, CSV, YAML) from a file or string. Returns typed data structures. Supports preview mode (return first N rows) for large files.

**Pipeline Internal**

- `scratchpad_read` — Read a value from the pipeline's key-value scratchpad by key.
- `scratchpad_write` — Write a value to the scratchpad under a given key. Used to carry intermediate state between steps without consuming conversation context.
- `log_observe` — Record an observation or reasoning note to the pipeline's execution log. Used for debugging and auditability.

### 4.3 Custom Tool Registration

Developers can extend the tool set by registering custom tools that conform to the tool schema interface. This allows the pipeline to be adapted to domain-specific use cases (e.g., database query tools, email senders, domain-specific API clients) without modifying the core framework.

---

## 5. Configuration

The configuration layer governs operational boundaries and behavioral parameters for the pipeline. Configuration is provided at initialization time and remains constant for the duration of a pipeline run.

### 5.1 Configuration Parameters

- **LLM Models**: Which language model(s) to use. Supports assigning different models to different components (e.g., a high-capability model for the Planner, a faster/cheaper model for the Evaluator).
- **Max Token Budget**: The total token allowance for the entire pipeline run across all cycles. Once exceeded, the pipeline terminates regardless of completion status.
- **Max Cycles**: The maximum number of Planner → Executor → Evaluator loops before forced termination.
- **Tool Timeout**: Default timeout for tool executions (can be overridden per tool).
- **Retry Policy**: How many times a failed tool invocation should be retried before surfacing as a step failure.
- **Logging Level**: Verbosity of the execution log (e.g., minimal, standard, verbose).

### 5.2 Termination Conditions

The pipeline terminates when any of the following conditions are met:

1. The Evaluator issues a **PASS** verdict (success).
2. The **max cycle count** is reached (graceful failure with partial results).
3. The **token budget** is exhausted (graceful failure with partial results).
4. An **unrecoverable error** occurs (e.g., a critical tool is unavailable).

On non-success termination, the pipeline returns whatever partial results have been produced along with a report explaining why it stopped and what remained incomplete.

---

## 6. Prompt Structure

The initial prompt is the sole input from the caller. It must contain enough information for the Planner to produce a meaningful plan. The prompt consists of three sections:

- **Goal**: A clear statement of what the agent should accomplish.
- **Context**: Supporting information — file locations, technology constraints, background knowledge, style preferences, or any domain-specific details the agent needs.
- **Expected Output**: A description of what the final deliverable should look like — file paths, formats, content criteria, and success conditions.

Example structure:

```
Goal: [What should be accomplished]

Context:
- [Relevant detail 1]
- [Relevant detail 2]
- [Relevant detail N]

Expected Output:
- [Deliverable 1 with format and location]
- [Deliverable 2 with format and location]
- [Success condition]
```

---

## 7. Scenario Simulations

The following simulations demonstrate how the pipeline handles two fundamentally different types of tasks using the same components and tool set.

### 7.1 Scenario A — Automated API Client Generation

**Domain:** Software development
**Task type:** Code generation, testing, and self-correction

#### Initial Prompt

```
Goal: Create a TypeScript API client module for the JSONPlaceholder API
(https://jsonplaceholder.typicode.com).

Context:
- Project uses Node.js with TypeScript
- Project root is at ./my-project
- Use axios for HTTP calls
- Follow existing code style in the project
- Testing framework is vitest

Expected Output:
- A typed API client at src/api/jsonplaceholder.ts
- Type definitions at src/api/types.ts
- Test file at src/api/__tests__/jsonplaceholder.test.ts
- All tests passing
```

#### Cycle 1 — Initial Attempt

**PLANNER** produces a 7-step plan:

| Step | Action | Tools |
|------|--------|-------|
| 1 | Explore project structure and code style | `directory_list`, `file_read` |
| 2 | Discover API endpoints by making sample requests | `http_request` |
| 3 | Generate TypeScript type definitions from API responses | `file_write` |
| 4 | Generate API client module matching project code style | `file_read`, `file_write` |
| 5 | Generate test file | `file_write` |
| 6 | Run the test suite | `shell_execute` |
| 7 | Verify all tests pass | (Evaluator) |

**EXECUTOR** carries out each step:

- **Step 1**: Lists the project directory, reads `package.json` and an existing utility file `src/utils/http.ts`. Stores code style observations in the scratchpad (async/await pattern, custom error class, camelCase conventions).
- **Step 2**: Makes HTTP GET requests to `/posts?_limit=1`, `/users?_limit=1`, and `/comments?_limit=1`. Captures response shapes and stores the discovered schema in the scratchpad.
- **Step 3**: Generates `src/api/types.ts` with `Post`, `User`, and `Comment` interfaces based on the discovered schema.
- **Step 4**: Reads the scratchpad for code style notes. Generates `src/api/jsonplaceholder.ts` with a `JsonPlaceholderClient` class containing typed methods (`getPosts`, `getPostById`, `getUsers`, `getCommentsByPost`, `createPost`).
- **Step 5**: Generates a test file with 4 test cases using vitest.
- **Step 6**: Runs `npx vitest run src/api` — **tests fail**. The error indicates that `axios` is not properly initialized: `TypeError: Cannot read properties of undefined (reading 'get')`.

The Executor logs the observation: *"Tests failed — axios instance not initialized. The client class is calling methods on axios directly instead of creating an instance with axios.create()."*

**EVALUATOR** inspects:

- Files exist: **types.ts** ✓, **jsonplaceholder.ts** ✓, **test file** ✓
- Tests passing: ✗ — TypeError during execution.
- Verdict: **FAIL**
- Feedback: *"The client class does not initialize an axios instance in its constructor. The existing project pattern in src/utils/http.ts uses axios.create() with a baseURL. The client must follow this pattern. Only the client module needs to be fixed — types and tests are fine."*
- Token usage: 3,800 / 10,000

#### Cycle 2 — Self-Correction

**PLANNER** receives the feedback and produces a minimal revised plan:

| Step | Action | Tools |
|------|--------|-------|
| 1 | Re-read `src/utils/http.ts` for the exact axios pattern | `file_read` |
| 2 | Rewrite the client module with proper axios initialization | `file_write` |
| 3 | Re-run the test suite | `shell_execute` |

**EXECUTOR** carries out the fix:

- **Step 1**: Reads the existing utility file. Confirms the pattern: `axios.create({ baseURL })` stored as a class property.
- **Step 2**: Rewrites the client module. The constructor now initializes a private `AxiosInstance` with the base URL. All methods use `this.http.get(...)` instead of `axios.get(...)`.
- **Step 3**: Runs the test suite — **all 4 tests pass**.

**EVALUATOR** inspects:

- Files exist: all three ✓
- Tests passing: ✓ (4/4)
- Code follows project conventions: ✓ (verified against scratchpad notes)
- Verdict: **PASS**
- Token usage: 5,200 / 10,000

#### Final Output

```
✅ Agent completed in 2 cycles (5,200 tokens used)

Files created:
  - src/api/types.ts              (Post, User, Comment interfaces)
  - src/api/jsonplaceholder.ts    (typed client with 5 methods)
  - src/api/__tests__/jsonplaceholder.test.ts  (4 tests, all passing)

Note: Cycle 1 failed due to missing axios instance initialization.
Auto-corrected in Cycle 2 by following existing pattern in src/utils/http.ts.
```

#### Key Observations

- The pipeline self-corrected a real bug without human intervention.
- The revised plan in Cycle 2 was surgical — only 3 steps instead of repeating all 7.
- The scratchpad carried code style context across steps without re-reading files.
- The evaluator validated actual test execution, not just file existence.

---

### 7.2 Scenario B — Student Learning Progress Insights

**Domain:** Education / data analysis
**Task type:** Data processing, statistical analysis, and report generation

#### Initial Prompt

```
Goal: Analyze student learning progress for Class 5B (Fall 2025 semester)
and produce an insight report with actionable recommendations.

Context:
- Grade data is in ./class-5b/grades.csv (columns: student_name, subject,
  assignment_name, score, max_score, date)
- Attendance data is in ./class-5b/attendance.csv (columns: student_name,
  date, status)
- There are 28 students, 6 subjects
- School grading policy: below 60% is failing, below 70% needs intervention
- Parent-teacher conferences are scheduled for next week

Expected Output:
- A comprehensive PDF report at ./class-5b/progress-report.pdf containing:
  - Class-wide performance overview
  - Per-subject trend analysis
  - Individual student flags (at-risk students)
  - Correlation between attendance and performance
  - Actionable recommendations for each flagged student
- A summary CSV at ./class-5b/flagged-students.csv for quick reference
```

#### Cycle 1 — Single-Pass Success

**PLANNER** produces an 8-step plan:

| Step | Action | Tools |
|------|--------|-------|
| 1 | Read and parse both CSV files | `file_read`, `data_parse` |
| 2 | Compute class-wide metrics | `shell_execute` |
| 3 | Compute per-subject trends over time | `shell_execute` |
| 4 | Compute per-student metrics and flag at-risk students | `shell_execute` |
| 5 | Analyze attendance-performance correlation | `shell_execute` |
| 6 | Generate recommendations for flagged students | (LLM reasoning) |
| 7 | Compile PDF report | `shell_execute`, `file_write` |
| 8 | Export flagged students CSV | `file_write` |

**EXECUTOR** carries out each step:

- **Step 1**: Reads both CSV files. Grades data contains 1,240 rows (28 students × ~7–8 assignments × 6 subjects). Attendance data contains 2,520 rows (28 students × 90 school days). Stores data shape summary in scratchpad.

- **Step 2**: Runs a data analysis script. Results: class average 72.4%, median 74.1%, pass rate 82.1%, intervention zone 14.3%, failing 3.6%. Highest subject: Art (81.2%), lowest: Math (65.8%). Stored in scratchpad.

- **Step 3**: Runs subject trend analysis. Identifies Math as declining over the semester (68.2% → 65.8%), English and Art as improving, and Science/History/PE as stable. Logs an observation: *"Math shows consistent decline — this is a systemic issue, not just individual students."*

- **Step 4**: Runs per-student analysis. Flags 5 students:

  | Student | Overall | Urgency | Primary Concern |
  |---------|---------|---------|-----------------|
  | Liam Chen | 54.2% | High | Multi-subject failure + chronic absence |
  | Sofia Rodriguez | 58.1% | High | Failing Math and Science |
  | Jake Thompson | 62.8% | Medium | Isolated Math failure (51%) despite good attendance |
  | Aisha Patel | 67.4% | Medium | Sharpest decline in class (78.2% → 67.4%) |
  | Marcus Williams | 69.1% | Low | Math below threshold, rest adequate |

  Also notes Noah Kim as the biggest improvement story (61.0% → 73.5%).

- **Step 5**: Runs attendance-performance correlation analysis. Finds a correlation coefficient of 0.73 (strong positive). Attendance breakdown for flagged students reveals that Liam (68.9%) and Sofia (77.8%) have significant absences, while Jake (91.1%) and Marcus (93.3%) attend regularly — suggesting their Math struggles are comprehension-based, not engagement-based. Aisha's absences are increasing monthly (2 → 3 → 4 → 4), mirroring her grade decline. Logs: *"Aisha's rising absences mirror her grade decline — possible external factor."*

- **Step 6**: Pure LLM reasoning step (no tool invocation). Generates tailored recommendations per student based on accumulated scratchpad data. Each recommendation set addresses the specific pattern discovered — attendance-driven interventions for Liam and Sofia, comprehension-focused support for Jake and Marcus, and a sensitive counselor-referral approach for Aisha. Also generates a class-wide recommendation to review Math curriculum pacing.

- **Step 7**: Runs a report generation script that produces charts (performance distribution, subject trend lines, attendance-performance scatter plot) and assembles an 8-page PDF. Verifies the file exists (245KB).

- **Step 8**: Writes `flagged-students.csv` with columns: student name, overall percentage, urgency, attendance percentage, primary concern, and top recommendation.

**EVALUATOR** inspects:

- PDF report exists: ✓ (8 pages, 245KB)
  - Class-wide overview: ✓
  - Per-subject trends: ✓
  - Individual student flags: ✓ (5 students)
  - Attendance correlation: ✓
  - Actionable recommendations: ✓
- Summary CSV exists: ✓ (5 rows, correct columns)
- Quality checks:
  - Recommendations are specific and actionable, not generic: ✓
  - Systemic Math issue identified as class-wide, not just individual: ✓
  - Aisha's case correctly identified as likely external factor: ✓
  - Distinction between attendance-driven and comprehension-driven struggles: ✓
- Verdict: **PASS**
- Token usage: 4,800 / 10,000

#### Final Output

```
✅ Agent completed in 1 cycle (4,800 tokens used)

Files created:
  - ./class-5b/progress-report.pdf    (8 pages, 245KB)
  - ./class-5b/flagged-students.csv   (5 at-risk students)

Key Findings:
  - 5 students flagged (2 high urgency, 2 medium, 1 low)
  - Math is declining class-wide — likely a curriculum/pacing issue
  - Strong attendance-performance correlation (0.73)
  - Aisha Patel's sharp decline may indicate external factors

Ready for parent-teacher conferences.
```

#### Key Observations

- The pipeline completed in a single cycle — the loop is not always multi-cycle.
- The Executor mixed tool-based steps (data analysis scripts) with a pure LLM reasoning step (recommendation generation) within the same plan.
- The scratchpad was essential — it carried computed metrics from steps 2–5 into step 6 without re-processing raw data or consuming token budget on large CSV contents.
- The Evaluator performed qualitative checks (specificity of recommendations, identification of systemic issues), not just structural validation.
- The same tool set (file read, shell execute, file write, scratchpad, log) served a completely different domain than Scenario A.

---

## 8. Cross-Scenario Validation Summary

These two simulations validate that the pipeline architecture is domain-agnostic and behaviorally adaptive:

| Characteristic | Scenario A (Code Gen) | Scenario B (Data Analysis) |
|---|---|---|
| Cycles needed | 2 (self-corrected) | 1 (first-pass success) |
| Primary tools | file I/O, HTTP, shell | file I/O, shell, data parse |
| LLM reasoning steps | 0 (all tool-driven) | 1 (recommendation generation) |
| Scratchpad usage | Code style reference | Accumulated metrics across steps |
| Evaluator strategy | Test execution pass/fail | Structural + qualitative checks |
| Planner adaptation | Surgical 3-step fix in Cycle 2 | N/A (single cycle) |

The same three components, the same tool set, and the same flow — applied to completely different problems — produced appropriate, autonomous behavior in both cases.
