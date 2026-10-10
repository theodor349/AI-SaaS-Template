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

1. Never kill processes solely by matching a name, path, or worktree string. Multiple agents and dev servers share this machine, and those matches can include unrelated processes or the agent itself. Stop `pnpm bootstrap` with Ctrl+C in its original terminal so it cleans up its managed services. If manual cleanup is necessary, target only processes you started or have verified belong to that bootstrap instance. A matching port or working directory alone does not prove ownership.

## Worktree development

- Use pnpm for all package management and scripts.
- `pnpm bootstrap` starts Next.js, local Convex, and Polar sandbox forwarding, installing missing dependencies along the way. Run it in a persistent terminal and wait for `Ready:` before opening the printed app URL. This is the worktree entry point instead of `pnpm dev`.
- For remote testing over Tailscale, use `pnpm bootstrap:tailscale` after stopping the current bootstrap in its owning terminal. It prints a private HTTPS URL and configures frontend/backend connections and checkout redirects. `--print` shows the URLs without starting services. Ctrl+C removes only the Tailscale proxies created by that run.
- Ports and `WORKTREE_ID` derive from the worktree path and stay stable across restarts. `pnpm bootstrap --print` shows them without starting anything. Occupied ports cause a startup error.
- Local database state lives in the worktree's gitignored `.convex`; Next.js output lives in `.next`. Restarting bootstrap keeps the database. Each worktree gets its own generated environment files.
- Development credentials come from the main checkout's gitignored `.env.bootstrap.local`. Worktree files and process variables can override them. Bootstrap generates the local URLs, so there is no need to copy another checkout's environment files.
- Clerk and Polar resources can be shared across worktrees. Use worktree-labeled test resources and separate browser contexts for different users. Shared Polar organizations can deliver events to every listener; `--no-polar` starts the stack without forwarding.
- `pnpm test:unit` and `pnpm lint` work without running services. Integration tests, E2E tests, and `pnpm inspect` use the running bootstrap environment and check that they target this worktree.
- Stop your bootstrap with Ctrl+C in its terminal. It cleans up its managed services while leaving other worktrees running.

## Verifying

- Start with the smallest proof that the change works. Run focused tests for the behavior you changed; add a regression test for bugs when practical.
- Test meaningful logic or observable behavior. Avoid tests that only assert layout, copy, props, callback wiring, or mirror the implementation.
- Run `pnpm test:unit` and `pnpm lint` after changes. Lint includes TypeScript checking. Broaden verification when the change or a failure warrants it.
- For backend or browser flows, keep `pnpm bootstrap` running and use the relevant integration or E2E tests. `pnpm inspect` supports manual browser verification. These tools target this worktree's generated local configuration.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Invoking [$implement](.agents/skills/implement/SKILL.md) with an issue, problem, or feature is an explicit request to implement it in the current T3-assigned worktree, open one PR, and handle bot feedback before asking the maintainer to review. Example: `$implement issue #123`. Do not create another worktree. Follow the skill's completion gates; do not merge the PR.
- Conventional commit titles, plain language: `fix(web): correctly handle Polar subscription events`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree.

## Taste

- Pages describe what is on the screen; nearby components implement how those parts work. Keep page-specific components in the page's `_components` folder, components shared across pages at their narrowest shared ancestor, and app-wide components in the global `components` folder. Pages own composition and route concerns; components own cohesive behavior and implementation details.
- Client components should call Convex hooks where the data or behavior is needed instead of prop drilling solely to avoid duplicate requests. Within the same Convex client, `useQuery` calls for the same query and argument values share a subscription. Components can also declare their own `useMutation` hooks, but each invocation executes a mutation. 
- Use existing Shadcn components when available. Install missing components with `pnpm dlx shadcn@latest add <component>` and follow the existing preset, theme tokens, and component patterns.
- `components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Automated browser tests and capturing required PR evidence are part of verification. Interactive browser or computer use requires the maintainer's explicit request or agreement.
- Security is important, but should not be over-indexed on.
- When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.
