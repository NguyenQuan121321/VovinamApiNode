# Agent State

This directory is reserved for supplementary execution state (e.g., machine-readable task ledgers) if a concrete workflow later requires it. Do not create additional state files in this task or without a stated purpose.

## Authority rules

- Source code is authoritative for what the system does.
- Git is authoritative for repository history.
- Tests are evidence: a claim about behavior is only as strong as its test run.
- `IMPLEMENTATION_PROGRESS.md` remains the main human-readable progress record; state files never replace it.
- `docs/PLAN.md` and `.agents/` prompts define intent and process; neither overrides observed repository reality.

When state files disagree with any of the above, the above win.

## Hard rules

- State files must never contain secrets, tokens, passwords, connection strings, or personal data.
- State files are disposable: the repository must remain fully recoverable (state, plan, and progress) from Git and the documented records alone.
