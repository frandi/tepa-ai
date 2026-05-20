# Demo: Study Plan (Human-in-the-Loop)

This demo showcases Tepa's **human-in-the-loop** capability. The user provides a learning goal, reviews and approves the generated plan, and decides whether to accept results or request another cycle of improvement.

## What It Does

1. **Prompts** the user for a learning goal (e.g., "Learn Rust programming")
2. **Plans** a study plan structure via the Planner
3. **Pauses for approval** — the user reviews the plan and approves or continues
4. **Executes** the plan steps, writing a detailed study plan to `study-plan.md`
5. **Evaluates** the output against quality criteria
6. **Pauses again on failure** — the user decides whether to run another improvement cycle or accept as-is

## Project Structure

```
demos/study-plan/
├── src/
│   └── index.ts              # Entry script — configures Tepa with human-in-the-loop events
├── prompts/
│   └── task.yaml             # Prompt defining the goal and expected output
├── run.sh                    # Cleans previous output and runs (Linux/macOS)
├── run.ps1                   # Cleans previous output and runs (Windows PowerShell)
└── package.json
```

## Human-in-the-Loop Events

This demo uses two event hooks to insert human checkpoints:

- **`postPlanner`** — Displays the generated plan with a dependency tree, then asks the user to approve before execution begins
- **`postEvaluator`** — If the evaluator fails, asks the user whether to continue with another cycle or accept the current results (overriding the verdict to "pass")

## Tools Used

- `file_read` — Read existing files
- `file_write` — Write the study plan to `study-plan.md`
- `directory_list` — Explore the output directory
- `scratchpad` — Carry state across execution steps

## Model Configuration

All four roles run on **`gpt-5.4-mini`** with tunable reasoning effort:

| Role            | Reasoning | Rationale                                                            |
| --------------- | --------- | -------------------------------------------------------------------- |
| `planner`       | `high`    | Builds a structured weekly plan that must satisfy evaluator criteria.|
| `evaluator`     | `high`    | Checks structural and qualitative criteria on the generated plan.    |
| `executor.high` | `medium`  | LLM reasoning steps that draft the study-plan content.               |
| `executor.low`  | `low`     | Cheap tool-param construction for `file_read`, `file_write`, etc.    |

## Running

Requires an `OPENAI_API_KEY` environment variable. Create a `.env` file in this directory:

```
OPENAI_API_KEY=sk-...
```

Then use the run script, which cleans previously generated output before starting:

```bash
# Linux/macOS
cd demos/study-plan
./run.sh

# Windows PowerShell
cd demos\study-plan
.\run.ps1
```

Or from the repo root:

```bash
npm start --workspace=@tepa/demo-study-plan
```

## Expected Output

The pipeline produces `study-plan.md` containing:

- Title and overview reflecting the user's goal
- Weekly breakdowns with specific topics
- Concrete learning resources (books, courses, websites)
- Practice exercises or projects per week
- Estimated time commitments

## Expected Behavior

The demo is interactive — it pauses twice for user input:

1. **Before execution**: Review the plan and type `yes` to approve
2. **After evaluation** (if failed): Choose whether to run another improvement cycle

The pipeline typically completes in 1 cycle when the user approves the initial plan.
