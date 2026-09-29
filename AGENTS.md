# OpenCode Entire Plugin (AGENTS.md)

## Linting and formatting

This project uses [oxlint](https://oxc.rs/docs/guide/usage/linter) for linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for formatting. Config lives in `.oxlintrc.json` and `.oxfmtrc.json`.

- Run `bun run format` and `bun run lint` after making code changes.
- Before finishing a task, `bun run format:check`, `bun run lint` and `bun run check` must all pass.
- Fix lint errors at the source; do not disable rules or add ignore comments unless there is a documented reason.
- Do not hand-format code or add other formatters/linters (Prettier, ESLint, Biome).
