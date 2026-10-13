# Worktree validation

Validated on 2026-10-07 with subagents working in two disposable, detached git
worktrees. The initial run used `a57a1dc`; the final run included the working
tree's testing tools and fixes. Runtime: Node.js 25.6.1, pnpm 10.12.4, macOS.
Use the supported Node.js 24 LTS version for new environments.

| Worktree | ID | Next | Convex API | Convex HTTP |
| --- | --- | --- | --- | --- |
| `agent-probe-a` | `wt-8bf4a10fdff8` | 13117 | 13118 | 13119 |
| `agent probe b` | `wt-10d86a5288f1` | 29350 | 29351 | 29352 |

Both paths were under `/Users/theodor349/Documents/git/`. Both used inherited
Clerk development credentials and the same Polar sandbox organization. All
temporary application probes stayed in the disposable worktrees. No secrets,
cookies, tokens, or auth URLs are included here.

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Baseline | PASS | Frozen install, original 24 bootstrap checks, and lint passed in both trees. Final `test:unit` passed 25 bootstrap/config checks and 6 Convex tests per tree; final lint passed. |
| Path-derived configuration | PASS | Repeated `bootstrap --print` values were stable and distinct; B's path contained spaces. |
| Concurrent startup | PASS | Both Next apps, both Convex API/HTTP servers, and both Polar listeners ran together. |
| Correct connections | PASS | Browser tests checked the Convex WebSocket host against each tree's derived URL. App, success, and webhook URLs, `.convex`, and `.next` belonged to their tree. |
| Database isolation | PASS | A held `81013118`; B held `82029351`. Neither query contained the other worktree's marker. |
| Persistence | PASS | Stopping and restarting A preserved its ID, ports, and numbers; B remained operational. |
| Clerk authentication | PASS | Distinct labeled development users signed into both URLs. Authenticated Convex queries recognized their names. The new official-helper E2E test passed in each tree. Credential override regression was fixed and retested. |
| Polar forwarding | PASS | Labeled `customer.created` sandbox samples reached both destinations. Temporary raw-body observation probes verified HMAC signatures. A-tagged and B-tagged samples each reached both listeners in the shared organization. |
| Port conflicts | PASS | A separately owned wildcard listener occupied B's Next port. Bootstrap failed clearly, left `.env.local` unchanged, and preserved the listener's response. |
| Failure cleanup | PASS | Ctrl+C released A's three ports while B stayed healthy. Killing only B's Next listener caused bootstrap exit 1 and released all three B ports while A remained healthy. No owned orphan processes remained. |
| Configuration safeguards | PASS | Missing credentials/live keys produced safe errors; generated files and storage were ignored; env files were private; the original env backup matched; cloud selectors were excluded; Polar used sandbox. Live-test guards refuse missing, cloud, and mismatched targets. |
| Manual inspection | PASS | `pnpm inspect` opened an authenticated browser. SIGTERM removed its owned Clerk user and session file. Nine descendants were tracked, with none left active. Session directory mode was 0700. |
| Cleanup | PASS | Only the two disposable worktrees, their owned processes, probes, session files, and test users were removed. Unrelated existing worktrees and hosted resources were preserved. |

The new live integration suite passed two tests in each worktree. The E2E suite
passed in each worktree, checking Convex identity, the connection URL, mutation
reactivity in another tab, persisted data after reload, and sign-out.

## Findings and reproduction

**Fixed: generated Clerk issuer blocked credential changes.** Bootstrap saved
`CLERK_JWT_ISSUER_DOMAIN` in `.env.local`. After one successful run, overriding
only the Clerk key pair in `.env.bootstrap.local` retained the previous issuer
and failed with a mismatch. Bootstrap now removes a generated issuer from
credential inputs and derives it from the selected key. Explicit issuer
overrides remain validated. The lifecycle test covers the regression. An actual
B override now reaches the occupied-port check, and A's configuration stays
unchanged. A second independent hosted Clerk application was not provisioned.

**Shared organization broadcasts events.** Start two stacks with the same
Polar sandbox organization and run `pnpm polar:trigger`. Both organization
listeners can receive the labeled sample. The command safely prints the local
delivery URL and HTTP status. Polar's CLI shares a delivery log across
listeners, so a trigger from A can report B's destination. Verify delivery at
each handler; do not infer worktree isolation from the CLI's single reported
destination.

**Cookies share the loopback hostname.** Different ports on `127.0.0.1` share
cookies within one browser profile. Use separate browser contexts or profiles
for concurrent users. E2E and inspection use dedicated contexts.

**Worktree labels filter events; they do not isolate delivery.**
`/webhooks/polar` verifies signatures, then acts only on customers labeled with
its own worktree ID (external ID prefix or `worktree_id` metadata) or already
linked locally; see [polarWebhook.ts](../convex/lib/polarWebhook.ts). Events
for other worktrees still arrive at every listener and are ignored there. Use
separate sandbox organizations when a test needs hosted isolation.

See [the agent workflow](../README.md#testing-a-feature-in-a-worktree) for the
repeatable unit, integration, E2E, manual inspection, and Polar commands.
