# Agent protocol

Session start: call get_project_context once. Do not re-read what it returned.
While working: append_plan_log after each meaningful step. record_decision for design choices.
Session end: update PROJECT_STATE.md, call save_checkpoint, then git_commit.
Rules: PLAN_LOG and DECISIONS are append-only. CHECKPOINTS is immutable. Use str_replace for small edits.
