# AI SaaS Template

This is a template that will be used by multiple downstream projects. This project acts as a starting point for new projects. It includes an agent friendly enviroment along with default patterns and architecute, which will help agents in new projects work as intended. Changes to this repo will eventually be included in downstream projects. 

## Techstack
- Next.js
- Convex
- Polar
- Clerk
- Shadcn
- Tailwind

## What makes this project special?

### 1. Tailored Taste
This project aligns with how Theodor Risager likes to build. The architecture, dependencies etc. are choosen so that Theodor can easilly inspect the project.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Agent friendly 
This project aims to make it as easy as possible for you the agent to develop in it. This means that you are able to work in parallel with other agents without intereferring with them and vice versa. This also means that if you stumble upon changes or improves we can make to the setup, that will improve your ability to work on it, please elevate it to a human.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing the Code.
- **we, us, and maintainers** mean Theodor and the other people building it. These are who you are talking to now.
- **user** means the person using not the template but the project using the template to. E.g. a calendar or ride sharing app.
- **agent** means the coding agent a user runs spins up to work on the project. Depending on context, that may also include you.
- **client** means the web UI.
- **environment** means one running server (next.js and convex) and the machine, filesystem, provider credentials, and state it owns.
- **project** refers to this template project.

## The ways to hurt yourself

1. Never kill processes solely by matching a name, path, or worktree string. Multiple agents and dev servers share this machine, and those matches can include unrelated processes or the agent itself. Stop `pnpm bootstrap` with Ctrl+C in its original terminal so it cleans up its managed services. If manual cleanup is necessary, target only processes you started or have verified belong to that bootstrap instance. A matching port or working directory alone does not prove ownership.

## Worktree development

- `pnpm bootstrap` starts Next.js, local Convex, and Polar sandbox forwarding, installing missing dependencies along the way. Run it in a persistent terminal and wait for `Ready:` before opening the printed app URL. This is the worktree entry point instead of `pnpm dev`.
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
- Conventional commit titles, plain language: `fix(web): correctly handle Polar subcription events`.
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

- `components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent. `shadcn/no-restyle` fails lint on violations.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on.
- When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.
