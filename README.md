# AI SaaS Template

A starting point for a web app with user accounts and paid plans, built on Next.js, Convex, Clerk, Polar, and shadcn/ui with Tailwind CSS. You create your own repository from it and build your product on top.

The template is set up so that several coding agents can work on it at the same time. Each agent works in its own Git worktree, and each worktree gets its own ports, local database, and environment files.

It ships no AI feature and no model provider SDK. You add those for your product.

## What it includes

- Sign-up and sign-in through Clerk.
- An account page where users edit their profile, pick a light, dark, or system theme, [export their data](docs/internals/data-export.md) as a JSON file, and delete their account. Deleting an account erases its data in the app and its customer record in Polar.
- Monthly, yearly, and lifetime Pro plans sold through Polar, with a pricing section, checkout, a billing page for switching or cancelling a plan, and Polar's customer portal. Backend functions check [paid access](docs/internals/paid-access.md) themselves and don't rely on the interface hiding a page.
- A withdrawal function for the 14-day right of withdrawal that EU consumers have. It refunds the purchase through Polar and emails a receipt through Resend.
- A switch, `billing: false` in [`app.config.ts`](app.config.ts), that removes pricing, checkout, and billing and gives every signed-in user full access. Such an app needs no Polar account. See [running without billing](docs/deployment.md#running-without-billing).
- Notes, a small reference feature that shows how a feature with user data is built. The [add-feature skill](.agents/skills/add-feature/SKILL.md) lists the patterns and the steps to remove Notes.
- Privacy policy, terms, and cookie policy pages, written as Markdown in [`content/legal`](content/legal) and filled in from `app.config.ts`. They are written for a Danish company that sells to consumers. Have a lawyer review them before you take real users. See [legal documents](docs/internals/legal-documents.md).
- A [cookie consent](docs/internals/consent.md) banner and preferences dialog. Optional services load only after the visitor agrees.
- [Feature flags](docs/internals/feature-flags.md) stored in Convex, each with a default, an override for everyone, and a per-user allowlist.
- An [installable app](docs/internals/installable-app.md). Chrome on Android can install it, and a service worker shows an offline page when the device has no connection.
- [Structured logging](docs/internals/logging.md). Every Convex function emits one JSON event, and the events hold no personal data.
- Optional Sentry error reporting for the Next.js server, for the browser once a visitor grants analytics consent, and for Convex functions. Without a DSN, Sentry never loads.
- [Security headers and a Content Security Policy](docs/internals/security-headers.md).
- Clerk and Polar [webhooks](docs/internals/user-webhook-contract.md) that verify signatures and are safe to redeliver.
- Rate limits on signed-in actions and on calls to Polar.
- A [maintenance mode](docs/deployment.md#pausing-the-app) that pauses sign-in, checkout, and every signed-in page during a migration.
- A landing page, a sitemap, an Open Graph image, and a `robots.txt` that blocks search engines until the build sets `ALLOW_SEARCH_INDEXING=true`.
- Unit tests with Vitest and convex-test, integration tests against the local backend, and Playwright browser tests.

## Built for coding agents

[AGENTS.md](AGENTS.md) holds the rules that agents follow. [`.agents/skills`](.agents/skills) holds workflows for them, such as taking a task from request to merged pull request, adding a feature, and merging later template changes into an app. `.claude/skills` links to the same folders for Claude Code.

`pnpm bootstrap` is what lets agents work in parallel. It derives ports and a `WORKTREE_ID` from the worktree's path, runs a local Convex backend with its database inside that worktree, and writes that worktree's environment files. The worktrees share one Clerk development instance and one Polar sandbox organization, and the `WORKTREE_ID` labels each worktree's test users and customers to keep them apart. See [worktree isolation](docs/internals/worktree-isolation.md).

The maintainers run their agents in [T3 Code](https://github.com/pingdotgg/t3code), which creates a worktree for each task. T3 Code is optional. Bootstrap works the same in a plain clone and in a worktree you create with `git worktree add`. The `implement` and `complete-worktree` skills name T3 Code's tools for starting a task in a new worktree, so adapt those steps when you use another tool.

[Tailscale](https://tailscale.com) is optional too. When the machine is connected to a tailnet that has MagicDNS and HTTPS certificates turned on, bootstrap serves the app at a private `https://<machine>.<tailnet>.ts.net:<port>` address, which your other devices on the tailnet can open. Otherwise bootstrap prints the reason and uses `http://127.0.0.1:<port>`. `--local` uses the loopback address without checking Tailscale, and `--tailscale` fails when Tailscale HTTPS is unavailable.

## Requirements

- macOS or Linux. The bootstrap scripts are written for these two.
- Git.
- Node.js 24, the version in [`.node-version`](.node-version).
- pnpm through Corepack. `corepack enable` selects the version that `package.json` pins.
- A Clerk application. Local development uses its development instance.
- A Polar sandbox organization at [sandbox.polar.sh](https://sandbox.polar.sh), unless the app runs without billing.

Local development needs no Convex account, because bootstrap runs Convex's local backend. A hosted deployment needs a Convex project and a Vercel project.

These are optional:

- Tailscale, for the private HTTPS addresses described above.
- The GitHub CLI, version 2.99.0 or newer and signed in, for the pull request scripts.
- Playwright's Chromium, for the browser tests, `pnpm inspect`, and `pnpm capture`. Install it with `pnpm exec playwright install chromium`.

`pnpm setup:check` checks the tools, the credentials, and the Clerk and Polar setup, and prints a fix for each problem it finds.

## Start a new app

1. Open [theodor349/AI-SaaS-Template](https://github.com/theodor349/AI-SaaS-Template) on GitHub, choose **Use this template**, then **Create a new repository**.
2. Clone your new repository.
3. Follow the setup steps below.

A repository created this way starts with one commit and shares no history with the template. Write down the template commit you started from. The [sync-template skill](.agents/skills/sync-template/SKILL.md) merges later template changes into your app, and its first run needs that commit.

To move an existing app with its data and users onto the template, follow the [migrate-app skill](.agents/skills/migrate-app/SKILL.md).

## Set up local development

1. Set the product name, company, support email, and the search and link preview details in [`app.config.ts`](app.config.ts), and replace the brand icon in [`app/icon.svg`](app/icon.svg). The favicons, link previews, and installed app icons are drawn from these two files.

   `app.config.ts` ships an example company: `Example Company ApS`, CVR `00000000`, an example address, and `support@example.com`. The legal pages publish these details, so replace all four with your own. A build with `ALLOW_SEARCH_INDEXING=true`, which marks the public production deployment, fails while any of the four still has its example value. Other builds accept them.

2. Create a Clerk application and use its development instance. Add a JWT template named `convex` from Clerk's Convex preset, following the [Convex Clerk setup](https://docs.convex.dev/auth/clerk). Under **User & authentication**, sign users in with an email verification code and Google, and turn off passwords.

3. In the Polar sandbox, create an organization access token with the scopes listed under [sandbox development token](docs/deployment.md#sandbox-development-token). Create three products: one billed monthly, one billed yearly, and a one-time product for lifetime access. Give each product one fixed, tax-inclusive price (see [deployment](docs/deployment.md#convex)).

   An app that launches free sets `billing: false` in `app.config.ts` and skips this step and every other Polar step.

4. In the main checkout, copy `.env.bootstrap.example` to `.env.bootstrap.local`. Add the Clerk development keys, the Polar token, and the three product IDs. Git ignores the file. Linked worktrees read the main checkout's copy, so you fill it in once.

5. Run `corepack enable`, then `pnpm setup:check`. Fix what it reports.

6. Run `pnpm bootstrap` in a terminal that stays open. It installs dependencies, then starts the local Convex backend, Next.js, and forwarding of Polar sandbox webhooks. Before it reports ready, it reads the product prices from Polar.

7. Wait for the `Ready:` line and open the address it prints. Ctrl+C or `pnpm bootstrap:stop` stops everything bootstrap started.

Use `pnpm bootstrap --no-polar` when billing is outside the task. It needs no Polar token.

An agent starts the stack with `pnpm bootstrap --detach` and waits with `pnpm bootstrap:wait`, because agent tools stop a background task after a time limit. A detached stack runs until `pnpm bootstrap:stop` or until the worktree is removed. On Linux with a systemd user manager it runs in its own scope, so it also survives the end of the agent's turn.

## Commands

### Local environment

| Command | What it does |
| --- | --- |
| `pnpm setup:check` | Checks prerequisites, credentials, the Clerk and Polar setup, Tailscale, the GitHub CLI, and this worktree's ports. `--offline` skips the network checks, and `--json` prints the results as JSON. |
| `pnpm bootstrap` | Runs an isolated local environment for this worktree. Takes `--local`, `--tailscale`, and `--no-polar`. |
| `pnpm bootstrap --detach` | Starts the environment in the background, detached from the terminal. Output goes to the log file. |
| `pnpm bootstrap --print` | Prints the ports, addresses, and network mode without starting anything. |
| `pnpm bootstrap:status` | Shows this worktree's bootstrap state, addresses, and log file. |
| `pnpm bootstrap:wait` | Waits until this worktree's bootstrap is ready. |
| `pnpm bootstrap:stop` | Stops this worktree's bootstrap and its services. |
| `pnpm bootstrap:tailscale` | Same as `pnpm bootstrap --tailscale`. |
| `pnpm db:reset --yes` | Clears this worktree's local Convex data. Bootstrap must be stopped. |
| `pnpm dev` | Starts Convex and Next.js without bootstrap, against the Convex deployment named in `.env.local`. [`.env.example`](.env.example) lists its variables. |

### Checks and tests

| Command | What it does |
| --- | --- |
| `pnpm lint` | Checks TypeScript and runs ESLint. |
| `pnpm typecheck` | Checks TypeScript only. |
| `pnpm test:unit` or `pnpm test` | Runs `test:bootstrap` and `test:app`. |
| `pnpm test:bootstrap` | Tests the worktree configuration, the startup safeguards, and the agent scripts. |
| `pnpm test:app` | Runs the application unit tests, without the dev-server fixtures that `test:bootstrap` starts. |
| `pnpm test:integration` | Checks the running worktree's local backend and frontend. Needs a running bootstrap. |
| `pnpm test:e2e [spec...]` | Runs the browser suite, or the given specs, in Chromium against the running worktree. With `E2E_EVIDENCE=1` it also saves screenshots and videos in `.playwright/results`. |
| `pnpm test:e2e:critical` | Runs only the browser tests tagged `@critical`. |
| `pnpm test:e2e:affected` | Runs the `@critical` tests plus the specs that [`tests/e2e/spec-map.json`](tests/e2e/spec-map.json) maps to the files changed since `origin/main`. `--list` shows the selection without running it. |

### Pull request tools

| Command | What it does |
| --- | --- |
| `pnpm inspect` | Opens the running worktree in a browser for manual inspection. |
| `pnpm capture <path...>` | Takes desktop and mobile screenshots of pages, and a video with `--video <seconds>`, as evidence for a pull request. It saves them outside the checkout. |
| `pnpm review-link` | Prints a single-use, signed-in link to the running worktree for a reviewer. |
| `pnpm clerk:sweep` | Deletes this worktree's leftover Clerk test users. Takes `--dry-run` and `--all-worktrees`. |
| `pnpm pr:gate [PR]` | Summarizes what still blocks a pull request from merging: checks, mergeability, whether it contains `main`, and open review threads. |
| `pnpm polar:trigger` | Sends a labeled sample event from the Polar sandbox to the organization's webhook listeners. |

### Build

| Command | What it does |
| --- | --- |
| `pnpm build` | Checks TypeScript and builds for production. |
| `pnpm build:vercel` | The command Vercel runs. It runs the application tests and lint, builds Next.js, and deploys the Convex functions. |
| `pnpm start` | Serves the production build. |
| `pnpm dlx shadcn@latest add <component>` | Installs a shadcn/ui component. |

## CI

GitHub Actions runs lint, the unit tests, and the Next.js build on every pull request, on GitHub-hosted runners. These checks need no provider credentials.

A separate E2E workflow runs the integration tests and the browser tests against a local bootstrap stack. It needs the Clerk development keys and the Polar sandbox settings as GitHub Actions secrets. When they are missing, as on a pull request from a fork, it reports a notice and skips.

- A pull request runs it only when it carries a label. With `run-e2e`, each push runs the `@critical` tests plus the specs mapped to the files the pull request changes, and the full suite when it changes a shared file. With `run-e2e-full`, each push runs the full suite.
- A nightly run on `main` covers the `@critical` tests, and the full suite on Sundays. The workflow has no `schedule` trigger, so your own scheduler starts it with `gh workflow run E2E --ref main -f suite=nightly`.

The E2E workflow runs on GitHub-hosted runners by default. To use a self-hosted runner, set the repository variable `E2E_RUNNER` to a JSON array of the runner's labels, such as `["self-hosted","my-runner"]`. Do this only in a private repository. [The CI runner](docs/deployment.md#the-ci-runner) explains why and has the commands.

## Deployment

Only `main` deploys. Vercel builds the Next.js app and deploys the Convex functions in the same build. [Deployment setup](docs/deployment.md) covers the Vercel and Convex settings, the Clerk and Polar webhooks, the Polar tokens, Sentry, and the E2E workflow's secrets.

## More documentation

- [AGENTS.md](AGENTS.md) has the project's rules for development, verification, pull requests, and code style.
- [`docs/internals`](docs/internals) explains the decisions and constraints that are hard to see from the code.
- [`docs/deployment.md`](docs/deployment.md) describes the hosted setup.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) says what kinds of contributions are welcome and what to run before opening a pull request. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## License

The template is under the [MIT license](LICENSE). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the files that come from other projects and their licenses.
