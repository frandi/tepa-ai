# Demo: Student Learning Progress Insights

This demo simulates **Scenario B** from the requirements document. Tepa analyzes student grade and attendance data for a class, produces an insight report with actionable recommendations, and exports a flagged students summary.

## What It Does

1. **Reads and parses** CSV data files (grades and attendance)
2. **Computes** class-wide metrics (averages, pass rates, subject trends)
3. **Identifies** at-risk students based on grading policy thresholds
4. **Analyzes** correlation between attendance and performance
5. **Generates** tailored recommendations for each flagged student (LLM reasoning step)
6. **Writes** a comprehensive progress report and a flagged students CSV

## Project Structure

```
demos/student-progress/
├── src/
│   └── index.ts              # Entry script — configures and runs Tepa
├── prompts/
│   └── task.yaml             # Prompt defining the goal and expected output
├── class-5b/                 # Mock data directory
│   ├── grades.csv            # 1,344 rows — 28 students × 6 subjects × 8 assignments
│   └── attendance.csv        # 1,764 rows — 28 students × 63 school days
├── run.sh                    # Cleans previous output and runs (Linux/macOS)
├── run.ps1                   # Cleans previous output and runs (Windows PowerShell)
└── package.json
```

## Mock Data

The CSV files contain realistic data designed to produce meaningful analysis:

- **28 students** across **6 subjects** (Math, English, Science, History, Art, PE)
- **Class average**: ~72%, with Math declining and Art/English improving
- **5 at-risk students** with distinct patterns:
  - Liam Chen (~54%) — multi-subject failure + chronic absence
  - Sofia Rodriguez (~58%) — failing Math and Science
  - Jake Thompson (~63%) — isolated Math failure despite good attendance
  - Aisha Patel (~67%) — sharpest decline, absences increasing monthly
  - Marcus Williams (~69%) — Math below threshold, rest adequate
- **Strong attendance-performance correlation** (~0.73)
- Noah Kim as an improvement story (61% → 73.5%)

## Tools Used

- `file_read` — Read CSV data files
- `file_write` — Write report and flagged students CSV
- `directory_list` — Explore data directory
- `data_parse` — Parse CSV into structured data
- `shell_execute` — Run data analysis scripts
- `scratchpad` — Carry computed metrics across steps
- `log_observe` — Record analytical observations

## Model Configuration

All four roles run on **`gemini-3.5-flash`** with tunable reasoning effort:

| Role            | Reasoning | Rationale                                                              |
| --------------- | --------- | ---------------------------------------------------------------------- |
| `planner`       | `high`    | Multi-step plan over CSV analysis, synthesis, and file writes.         |
| `evaluator`     | `high`    | Must catch both structural and semantic errors in the output.          |
| `executor.high` | `medium`  | LLM reasoning steps that synthesize metrics into narrative + CSV rows. |
| `executor.low`  | `minimal` | Tool-param construction for `file_read`, `file_write`, `shell_execute`, etc. |

`low` reasoning on `executor.high` was insufficient — the synthesis step fabricated student names instead of using the parsed metrics. `medium` is the working floor for this demo.

## Running

Requires a `GEMINI_API_KEY` environment variable. Create a `.env.local` file in this directory:

```
GEMINI_API_KEY=...
```

Then use the run script, which cleans previously generated output before starting:

```bash
# Linux/macOS
cd demos/student-progress
./run.sh

# Windows PowerShell
cd demos\student-progress
.\run.ps1
```

Or from the repo root:

```bash
npm start --workspace=@tepa/demo-student-progress
```

## Expected Output

The pipeline produces two files in `class-5b/`:

- **`progress-report.md`** — Class-wide overview, per-subject trends, individual student flags, attendance correlation, and actionable recommendations
- **`flagged-students.csv`** — Quick-reference CSV with student name, overall percentage, urgency level, attendance rate, and primary concern

## Expected Behavior

The evaluator performs both structural checks (files exist, correct format) and qualitative checks (recommendations are specific, systemic issues identified). The scenario typically completes in **1–2 cycles**: a clean run lands in one, but a second cycle is sometimes needed when the planner-written Python script imports a library that isn't available in the sandbox (e.g. `pandas`) — the evaluator catches it and the next plan switches to standard-library code.
