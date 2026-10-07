# AI SaaS Template

Next.js, Convex, Clerk, and Shadcn UI, using pnpm.

## Development

1. Run `pnpm install`.
2. Copy `.env.example` to `.env.local` and fill in your Clerk API keys.
3. Follow the [Convex Clerk setup](https://docs.convex.dev/auth/clerk) and set
   `CLERK_JWT_ISSUER_DOMAIN` on your Convex deployment.
4. Run `pnpm dev`. Convex will configure your deployment and write
   `NEXT_PUBLIC_CONVEX_URL` before starting Next.js.

## Commands

- `pnpm bootstrap` - run an isolated local environment for this worktree.
- `pnpm bootstrap --print` - print path-derived ports and URLs without starting services.
- `pnpm bootstrap --no-polar` - run Next.js and local Convex without billing.
- `pnpm test:bootstrap` - test worktree configuration and startup safeguards.
- `pnpm test:unit` (or `pnpm test`) - run bootstrap checks and fast Convex behavior tests.
- `pnpm test:integration` - exercise the running worktree's real local backend and frontend.
- `pnpm test:e2e` - test Clerk authentication, Convex identity, reactive UI writes, and persistence in Chromium.
- `pnpm inspect` - open the running worktree for manual browser inspection.
- `pnpm polar:trigger` - send a labeled Polar sandbox sample event to organization listeners.
- `pnpm dev` - start Convex and Next.js.
- `pnpm typecheck` - check TypeScript.
- `pnpm lint` - check TypeScript and run ESLint.
- `pnpm build` - build for production.
- `pnpm start` - serve the production build.
- `pnpm dlx shadcn@latest add <component>` - install a Shadcn component.

## Agent worktrees

Use Node.js 24 LTS (or Node.js 22.12+). In the main checkout, copy `.env.bootstrap.example` to
`.env.bootstrap.local` and add Clerk **development** keys and a Polar **sandbox**
organization access token. Then run `pnpm bootstrap` in any T3 Code worktree.
The script installs missing dependencies with `pnpm install --frozen-lockfile`.
Polar's CLI is included in the project's development dependencies.

Credentials are loaded from the main checkout's `.env.bootstrap.local`, with
overrides from the current worktree's `.env.local`, `.env.bootstrap.local`, and
provider variables in the process environment, in that order. Existing Clerk
development keys in the main checkout's `.env.local` also work as a fallback.
The Clerk JWT issuer is derived from the publishable key and set on local Convex;
configure Clerk's `convex` JWT template as in the regular development setup.

The canonical absolute worktree path determines a stable `WORKTREE_ID`, three
ports, app and Convex URLs, and Polar success/webhook URLs. Different paths can
hash to the same finite port block; an occupied port causes a clear startup error
instead of changing URLs. Moving a checkout changes its ID and ports.

Bootstrap writes private, ignored `.env.local`, `.env.convex.local`, and
`.env.convex-watch.local` files. It preserves the original `.env.local` once as
`.env.before-bootstrap.local`. Convex data stays in that checkout's `.convex`
directory, and Next.js output stays in `.next`. Ctrl+C or a service failure stops
the managed processes, including when a Next listener or Convex backend exits
while its CLI remains running. Next listener monitoring allows five seconds for
configuration restarts. Bootstrap reports ready only after the app returns a
successful HTTP response. Local data remains available on the next run. Cloud Convex
deploy keys are removed from child environments, and Polar commands always use
the sandbox environment.

Polar CLI output is suppressed because it prints the webhook signing secret.
Bootstrap reports the forwarding URL and stops the stack if the listener exits.
Keep authentication diagnostics limited to status codes and test outcomes; never
print cookies, tokens, redirect query parameters, or environment file contents.

Polar events are forwarded to the worktree's Convex HTTP server at
`/webhooks/polar`; the billing feature must implement that endpoint with signature
verification using `POLAR_WEBHOOK_SECRET`. Until then, deliveries return 404.
Use `WORKTREE_ID` when creating test users, customers, and products to distinguish
them. Bootstrap does not create billing plans or test accounts.

Clerk settings and Polar organization data are shared when using shared
credentials. Polar forwards organization events, so separate worktree namespaces
alone do not isolate webhook deliveries. For strict isolation, supply a separate
Clerk development application and Polar sandbox organization in each worktree's
`.env.bootstrap.local`; otherwise handlers must ignore events belonging to other
worktrees. Those hosted credentials cannot be derived from a filesystem path.
Vercel access is only needed for hosted previews or deployment.

## Testing a feature in a worktree

The [two-worktree validation report](docs/worktree-validation.md) records the
verified behavior and the remaining billing boundary.

Start with `pnpm install --frozen-lockfile`, `pnpm test:unit`, and `pnpm lint`.
These checks need no hosted credentials. Backend tests use Convex's recommended
[convex-test](https://docs.convex.dev/testing/convex-test) mock, so also exercise
new backend behavior against the real server.

Run `pnpm bootstrap` in a persistent terminal, then in another terminal in the
same worktree:

```sh
pnpm exec playwright install chromium
pnpm test:integration
pnpm test:e2e
pnpm inspect
```

The live tests and inspector read bootstrap's generated local configuration.
They refuse cloud deployments, a different worktree's URLs, and live Clerk keys.
They do not start or stop the stack. Integration and browser tests add scratch
numbers to this worktree's database; dispose of the worktree when those records
are no longer needed. They never reset existing data.

`pnpm inspect` signs in a temporary test user and opens Chromium with that
session. Close the browser or press Ctrl+C to delete the user and private local
session file. Use `pnpm inspect codegen` for Playwright's interactive recorder.
Keep any generated test code free of cookies, tokens, and hosted session URLs.

E2E uses [Clerk's official Playwright helpers](https://clerk.com/docs/guides/development/testing/playwright/test-helpers)
and creates a temporary development user with a worktree label and a
`+clerk_test` email address. It removes that user on completion, including test
failures. The Clerk application must allow email users with first/last names,
and its `convex` JWT template must provide the `name` claim for the existing
demo query. A visible welcome message verifies the identity reached Convex.
The test also checks the browser connects to this worktree's Convex URL,
updates another tab after a mutation, and preserves the result after reload.

Use separate browser contexts or profiles to compare worktrees as different
users. Cookies belong to the hostname, so both `127.0.0.1` URLs share cookies
within one profile even when their ports differ. Browser recordings are disabled
for authenticated tests. Any inspector auth state stays under ignored
`.playwright/`; do not share it or log session URLs and tokens.

Polar startup verifies the sandbox credentials and establishes forwarding. A
404 from `/webhooks/polar` verifies routing only. Signature verification,
billing state updates, checkout flows, and cross-worktree event filtering need
the billing implementation before they can have passing integration tests.
Use `pnpm polar:trigger` against the running stack to send a labeled
`customer.created` sample; this generates an event without creating a customer.
The command loads sandbox credentials privately and prints only local delivery
URLs and status. It currently exits unsuccessfully when the handler returns 404.
All listeners in the shared organization may receive the event. The Polar CLI's
shared delivery log can report another worktree's destination, so its output
cannot prove delivery to each listener or isolation. Verify raw-body signatures
and worktree filtering in handler tests once the billing feature exists.

## Shadcn

Preset `b38VmX78S` is applied in `components.json` and `app/globals.css`.
`@shadcn/lint` is registered in `eslint.config.mjs`; no Shadcn rules are
currently enabled. Configure rules there using the
[available rules](https://github.com/shadcn-ui/lint#rules).

Agent instructions live in `AGENTS.md`. `CLAUDE.md` references that file.
