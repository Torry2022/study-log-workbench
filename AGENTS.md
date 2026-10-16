# Workspace rules

- Follow DESIGN.md and existing product interactions. No marketing redesign.
- One owner, Chinese UI, Asia/Shanghai, month/year Markdown day blocks, /study-log.
- Operate only on explicitly configured synthetic or authorized instance data. Never use a parent directory as an implicit data root.
- Keep source, instance configuration, user data, indexes and backups separate. Never commit credentials, user logs, screenshots with private content, signing files or build output.
- Harmony implementation may proceed against the maintainer-verified Web/API baseline. Independent Web installation and independently verified Harmony installation remain release gates; do not mark either passed without evidence.
- Investigate architecture while implementing each outcome. Record proven defects separately from suspected risks. Refactor only where an identified responsibility or testing problem warrants it.
- Preserve behavior with focused tests. For Web code run typecheck, production build and relevant browser checks. Test actual entrypoints and lifecycle wiring, not just copied components.
- Commit each independently verified outcome with its related tests and documentation. Review staged files and scan credentials before committing. Do not rewrite history.
- Do not operate on any personal or production instance as a side effect of this project.
- Keep docs/implementation-status.md and docs/architecture.md consistent with the implementation. Never mark an unexecuted check passed.

## Design decisions and evaluation

- Before substantial implementation, check whether the problem is a local defect or a misplaced responsibility. Give brief code/experiment evidence and identify what to keep, replace and remove; do not make the user discover the architectural question first.
- For language understanding and routing, compare deterministic rules, existing model calls and reusable libraries before extending regexes or adding another stage. Keep dates, permissions, budgets and source identity under code control. Reuse existing calls where appropriate; do not assume an extra model or Agent improves results.
- Use real questions to expose failures, not to define implementation branches. Never hardcode evaluation questions, project names, dates or expected answers to improve scores. Verify general rules across different wording, subjects and positive/negative controls; keep private examples outside Git.
- Refactor when responsibilities or state are demonstrably tangled. Preserving behavior does not require preserving the existing structure; remove paths made obsolete by the change rather than stacking compatibility branches without actual consumers. Do not expand a local repair into an unsupported rewrite.
- Review previous experiments and why they failed before proposing another. Distinguish observed defects from hypotheses. Regression tests establish behavior and compatibility, not design quality or model-answer accuracy; define the relevant benefit and cost checks separately.
- Journal Q&A should help users find, recall, organize and understand their own learning records, including project progress. General knowledge may support understanding; a general expert assistant is not the evaluation target. A small test run or completed refactor is not completion of the overall Q&A improvement goal. Report implemented, experimental and unfinished work separately.
