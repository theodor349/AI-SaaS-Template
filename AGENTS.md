# AI SaaS Template

This template provides shared architecture, UI patterns, and an agent-friendly development environment for downstream projects. Changes here may be carried into those projects.

## Tech stack

- Next.js
- Convex
- Polar
- Clerk
- Shadcn
- Tailwind

## Principles

- Choose architecture and dependencies that Theodor and the maintainers can readily inspect and understand.
- Consider the performance impact of data subscriptions, rendering, and animations when making changes.
- Support agents working in parallel without interfering with each other. Report useful improvements to the development setup to a maintainer.

## A small glossary

- **maintainer** means Theodor or another person developing the project and directing the agent.
- **user** means a person using an application built from this template.
- **agent** means a coding agent working on the project, including you.
- **environment** means a worktree's running Next.js and Convex services and local state. The machine and hosted provider resources may be shared.

## The ways to hurt yourself

1. Never kill processes solely by matching a name, path, or worktree string. Multiple agents and dev servers share this machine, and those matches can include unrelated processes or the agent itself. Stop bootstrap with `pnpm bootstrap:stop`, which verifies the recorded supervisor before signaling it, so it cleans up its managed services. Ctrl+C also stops a run in its original terminal. If the supervisor died without shutting down, `bootstrap:stop` reclaims the service process groups and Tailscale routes its state file recorded. If manual cleanup is necessary, target only processes you started or have verified belong to that bootstrap instance. A matching port or working directory alone does not prove ownership.

## Worktree development

- Use pnpm for all package management and scripts.
- `pnpm setup:check` checks prerequisites and provider setup. Run it first when a worktree misbehaves.
- `pnpm bootstrap --detach` starts Next.js, local Convex, and Polar sandbox forwarding in the background, syncing dependencies along the way, and returns once the run has started. Then use `pnpm bootstrap:wait` to block until it is ready. This is the worktree entry point instead of `pnpm dev`. Always start it with `--detach`. Agent harnesses kill background tasks after a time limit, and a plain `pnpm bootstrap` started as one dies with it.
- A detached run keeps going after your session ends. Run `pnpm bootstrap:stop` before ending your session, unless the maintainer asked you to keep the stack running or you shared a `pnpm review-link` with them. In that case leave it running and say so in your report; complete-worktree cleanup stops it later, and it stops itself when T3 Code removes the worktree.
- Stacks in parallel worktrees share the machine's CPU and disk. When you start several at once, run large data loads such as imports and seeds one at a time, and start the next when the previous one finishes.
- Bootstrap uses private Tailscale HTTPS URLs when Tailscale is connected with HTTPS, and loopback URLs otherwise. `--local` forces loopback; `--tailscale` requires Tailscale. The URLs are fixed at startup, so switching modes needs a restart.
- `pnpm bootstrap:status` shows the run's state, URLs, and log file; `pnpm bootstrap:stop` stops this worktree's verified bootstrap from any terminal. A `stale` status means the supervisor was killed without its shutdown; `pnpm bootstrap:stop`, or the next `pnpm bootstrap`, reclaims what it left running. Service output is also written to the log; read it there for a detached run or when you do not own the terminal.
- Share inspection links with the maintainer only over Tailscale HTTPS, verified to respond first. `pnpm review-link [--plan …] [--path …]` prints a single-use signed-in link for them; never paste it into PRs or issues. Do not share localhost or loopback URLs for maintainer inspection.
- Ports and `WORKTREE_ID` derive from the worktree path and stay stable across restarts. `pnpm bootstrap --print` shows the effective configuration. On a port collision, set `BOOTSTRAP_PORT_BLOCK` in this worktree's `.env.bootstrap.local`.
- Local database state lives in the worktree's gitignored `.convex`; Next.js output lives in `.next`. Restarting bootstrap keeps the database; `pnpm db:reset --yes` clears it while bootstrap is stopped. Each worktree gets its own generated environment files.
- Credentials come from the main checkout's `.env.bootstrap.local` (see the README); worktree files and process variables override them. Do not copy another checkout's environment files.
- Clerk and Polar resources can be shared across worktrees. Use worktree-labeled test resources and separate browser contexts for different users. Shared Polar organizations can deliver events to every listener; `--no-polar` starts the stack without forwarding. `pnpm clerk:sweep` removes this worktree's leftover test users.
- `pnpm test:unit` and `pnpm lint` work without running services. Integration tests, E2E tests, `pnpm inspect`, `pnpm capture`, and `pnpm review-link` use the running bootstrap environment and check that they target this worktree.
- Record persistent commands other than bootstrap and their owning terminals as they start, following [resource tracking and cleanup](.agents/skills/complete-worktree/references/cleanup.md). Bootstrap's own state file is its ownership record.

## Verifying

- Start with the smallest proof that the change works. Run focused tests for the behavior you changed; add a regression test for bugs when practical.
- Test meaningful logic or observable behavior. Avoid tests that only assert layout, copy, props, callback wiring, or mirror the implementation.
- Run `pnpm test:unit` and `pnpm lint` after changes. Lint includes TypeScript checking. Broaden verification when the change or a failure warrants it.
- For backend or browser flows, keep `pnpm bootstrap` running and use the relevant integration or E2E tests. `pnpm inspect` supports manual browser verification. These tools target this worktree's generated local configuration.

## Pull requests

- A maintainer request to implement something (an issue, bug fix, or feature) follows [$implement](.agents/skills/implement/SKILL.md), whether or not they name the skill. Example: `$implement issue #123` or "fix the broken pricing toggle".
- Once the change is implemented and verified, continue into [$complete-worktree](.agents/skills/complete-worktree/SKILL.md) in the same session without asking.
- Hold the merge, not the PR, when the maintainer asked to see the change first or when you need their input: an open question about scope or behavior, a visual or product choice they should judge, or a blocker you cannot resolve. Open the PR and handle CI and review comments while you wait, report what you need, and merge once they confirm. Skip the PR only when the maintainer asked you not to open one.
- Invoking `$complete-worktree` directly requests completion of existing task changes, including from a session that never used `$implement`. Both workflows authorize one PR, review replies and fixes, merge after the skill's verification gates, deletion of the task branch, shutdown of owned services and terminals, and removal of the worktree's build output and temporary files after merge. Stay in the current T3-assigned worktree and don't create another worktree with git. A session in the main checkout starts the task in a new thread instead, as [$implement](.agents/skills/implement/SKILL.md) describes. Reading or editing these skills does not invoke the workflows. Honor explicit maintainer restrictions such as keeping a PR open.
- Questions, research, plans, and reviews are not implementation requests. Never make a PR for them unless the maintainer explicitly asks.
- Conventional commit titles, plain language: `fix(web): correctly handle Polar subscription events`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video. Capture them with `pnpm capture <path…> --label before|after [--video <seconds>]` and attach them with `gh pr create|edit|comment --attach` (gh 2.99.0+).
- Captures show synthetic data. Seed invented users and content, and never capture production, real users' data, or a cloud deployment that holds a copy of either. Take only the shots a reviewer needs to judge the change.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks.
- Put unfinished features behind a [feature flag](docs/internals/feature-flags.md) so they can merge turned off.
- When babysitting: poll `pnpm pr:gate` for checks and comments newer than the last push, verify each review finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Do not wait for or request a review from a bot. Stop when checks are green on the latest commit and no review thread is unresolved.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material in this worktree's scratch directory, `$(git rev-parse --path-format=absolute --git-path agent-scratch)`. It is outside tracked source, on disk rather than in a memory-backed `/tmp`, and removed with the worktree.

## Taste

- Pages describe what is on the screen; nearby components implement how those parts work. Keep page-specific components in the page's `_components` folder, components shared across pages at their narrowest shared ancestor, and app-wide components in the global `components` folder. Pages own composition and route concerns; components own cohesive behavior and implementation details.
- A new feature with user data follows the [$add-feature](.agents/skills/add-feature/SKILL.md) checklist, using Notes as the reference implementation. The skill also lists the steps to remove Notes.
- Convex functions live in a folder per feature, such as `convex/billing/`, with that feature's helpers and tests beside them. Start a new feature in its own folder even when it is one file. The `convex` root keeps only the files Convex requires there and cross-cutting modules; `convex/lib` holds helpers several features share. A file's path is its functions' API path, and queued scheduled jobs store that path, so moving a function later breaks jobs already scheduled under the old one.
- Write JSX so its structure is easy to scan. Avoid nested ternaries or chains of conditions inside JSX. Extract components around cohesive behavior.
- Client components should call Convex hooks where the data or behavior is needed instead of prop drilling.
- Each component owns its loading state. Keep the page shell visible while its components load independently. Use dynamic skeletons that match the loaded component's dimensions, spacing, fields, controls, and text wrapping at supported screen sizes. Keep skeleton markup close to the component so layout changes update both states together.
- Use existing Shadcn components when available. Install missing components with `pnpm dlx shadcn@latest add <component>` and follow the existing preset, theme tokens, and component patterns.
- `components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- Make action progress clear where the action happens, for as long as it is pending. Keep the layout stable and prevent duplicate submissions. Let the resulting UI communicate success; add feedback only when it provides useful information.
- Make errors easy to notice and understand. Choose feedback that fits the error’s context and duration, keeping ongoing failures visible near the affected content until resolved. Avoid repeated notifications for the same failure.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

For examples of page composition, component-owned skeletons, and action versus job errors, see the [account page](app/(protected)/account/page.tsx). Apply the rules above to new features, using these examples to understand the intended structure and state placement.

## Additional tips

- Automated browser tests and capturing required PR evidence are part of verification. Interactive browser or computer use requires the maintainer's explicit request or agreement.
- Security is important, but should not be over-indexed on.
- Treat users' personal data like secrets. Never print, copy, commit or capture emails, names or other personal fields from production or a cloud deployment. Report ids and counts instead.
- Moving an existing app, with its data, users and paying customers, onto this template follows [$migrate-app](.agents/skills/migrate-app/SKILL.md).
- When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.
- Bringing new template commits into an app built on this template follows [$sync-template](.agents/skills/sync-template/SKILL.md). An app fix that belongs in the template goes to the template as its own PR.
