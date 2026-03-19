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

## Running

Requires an `ANTHROPIC_API_KEY` environment variable. Create a `.env` file in this directory:

```
ANTHROPIC_API_KEY=sk-ant-...
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

This scenario typically completes in a **single cycle** — demonstrating that the pipeline loop isn't always multi-cycle. The evaluator performs both structural checks (files exist, correct format) and qualitative checks (recommendations are specific, systemic issues identified).
