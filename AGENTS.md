# OpenCode Entire Plugin (AGENTS.md)

## Runtime and package manager (Bun)

This is a Bun project. Use Bun everywhere; never Node.js, npm, npx, yarn or pnpm.

- Install dependencies with `bun install` (lockfile is `bun.lock`; commit it, never create `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`).
- Add/remove packages with `bun add [-d] <pkg>` / `bun remove <pkg>`.
- Run scripts with `bun run <script>`; run files with `bun <file>` (not `node <file>` or `ts-node`/`tsx`).
- Run one-off binaries with `bunx <bin>` (not `npx`).
- Run tests with `bun test` (`bun:test`), not Jest/Vitest/`node --test`.
- Prefer Bun built-ins over Node packages where available (`Bun.file`, `Bun.write`, `Bun.$`, `bun:sqlite`, `Bun.serve`), and don't add `dotenv` (Bun loads `.env` automatically).
- TypeScript runs directly under Bun; no build step or transpiler is needed.

## Linting and formatting

This project uses [oxlint](https://oxc.rs/docs/guide/usage/linter) for linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for formatting. Config lives in `.oxlintrc.json` and `.oxfmtrc.json`.

- Run `bun run format` and `bun run lint` after making code changes.
- Before finishing a task, `bun run format:check`, `bun run lint` and `bun run typecheck` must all pass.
- Fix lint errors at the source; do not disable rules or add ignore comments unless there is a documented reason.
- Do not hand-format code or add other formatters/linters (Prettier, ESLint, Biome).
