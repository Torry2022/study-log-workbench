# Workspace rules

- Follow DESIGN.md and existing product interactions. No marketing redesign.
- One owner, Chinese UI, Asia/Shanghai, month/year Markdown day blocks, /study-log.
- Operate only on explicitly configured synthetic or authorized instance data. Never use a parent directory as an implicit data root.
- Keep source, instance configuration, user data, indexes and backups separate. Never commit credentials, user logs, screenshots with private content, signing files or build output.
- Web and supporting services must pass their complete acceptance gate before Harmony implementation.
- Investigate architecture while implementing each outcome. Record proven defects separately from suspected risks. Refactor only where an identified responsibility or testing problem warrants it.
- Preserve behavior with focused tests. For Web code run typecheck, production build and relevant browser checks. Test actual entrypoints and lifecycle wiring, not just copied components.
- Commit each independently verified outcome with its related tests and documentation. Review staged files and scan credentials before committing. Do not rewrite history.
- Do not operate on any personal or production instance as a side effect of this project.
- Keep docs/implementation-status.md and docs/architecture.md consistent with the implementation. Never mark an unexecuted check passed.
