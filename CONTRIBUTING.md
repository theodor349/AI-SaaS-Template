# Contributing

Bug reports and small, focused fixes are welcome.

## What to send

- A bug report. Open an issue that says what you did, what you expected, and what happened.
- A small fix. Open a pull request that changes one thing.
- A larger change, such as a new feature, a new dependency, or a change to the architecture. Open an issue before you write the code, so the work is not wasted if the change does not fit the template.

Report security problems privately, as [SECURITY.md](SECURITY.md) describes, and not in an issue.

## Before you open a pull request

Run both of these. Neither needs running services or provider accounts.

```sh
pnpm lint
pnpm test:unit
```

Give the pull request a [conventional commit](https://www.conventionalcommits.org/) title in plain language, such as `fix(web): correctly handle Polar subscription events`. In the description, state the problem and how the change fixes it.

[AGENTS.md](AGENTS.md) holds the project's conventions. The maintainers and their coding agents follow it, and a pull request that follows its code conventions is easier to review. Its sections on worktrees, bootstrap, and the pull request workflow describe the maintainers' own setup, and outside contributors can skip them.

## What CI runs on a pull request from a fork

GitHub Actions runs lint, the unit tests, and the Next.js build on every pull request, including one from a fork.

The E2E suite does not run on a pull request from a fork. It signs in through Clerk and buys plans in the Polar sandbox, and GitHub does not pass the repository's Clerk and Polar secrets to a workflow that a fork starts.

## License

Contributions are under the project's [MIT license](LICENSE).
