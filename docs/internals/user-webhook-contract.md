# User readiness and webhook transactions

An authenticated identity can exist before its application record. `users.current` derives the caller from `requireIdentity` and returns `provisioning`, `ready`, or `deleting`. Anonymous calls fail with `UNAUTHENTICATED`; missing records do not mean sign-out. Mount auth-dependent consumers below Convex authentication readiness. The [provisioning component](../../components/UserProvisioning.tsx) calls `users.ensureCurrentUser` after authentication settles; the action fetches the verified identity from Clerk's Backend API, so local sign-in needs no webhook tunnel. A ready record grants no paid access; see [paid access](paid-access.md).

[Profile synchronization](../../convex/users.ts) patches only its own fields, so billing extends the user schema without profile delivery or provisioning resetting entitlement. Provider IDs and arbitrary lookup remain internal; account features should use the identity-derived current-user API.

## Webhook processing

Provider adapters in [convex/http.ts](../../convex/http.ts) verify the original body, then hand an internal business mutation to the shared [processDelivery](../../convex/webhooks.ts). Follow the existing Clerk and Polar adapters when adding a provider.

Database effects and successful completion commit in one serializable transaction. Simultaneous deliveries serialize on the indexed tracking key. A crash before commit rolls everything back; a lost HTTP response after commit is safe to redeliver. There are no persisted processing locks, leases, or workers that need recovery. Successful duplicates return 200; failures return 503 and rely on provider redelivery. Unknown valid types are deliberately acknowledged. Bad signatures and malformed required payloads return 400 without domain writes. Each attempt's [wide event](logging.md) carries delivery context and fixed failure codes, never raw provider errors or profiles.

Delivery history expires 30 days after the last attempt, so tracking cannot provide permanent business idempotency. Each domain handler must also use durable resource IDs, revisions, or monotonic transitions. Clerk keeps `updated_at` plus event timestamp to reject stale updates and retains terminal identity tombstones across tracking expiry. External side effects require a transactional outbox/durable workflow and provider idempotency keys; do not execute them inside this database-only processing handler.

## Deletion

Clerk deletion atomically marks the application user `deletion_requested` and creates one [account lifecycle request](../../convex/accountLifecycle.ts), including when the user did not previously exist. Its processor performs resumable cleanup, then marks completion and user lifecycle `deleted` together. The user record is retained until cleanup finishes, and its minimal identity tombstone afterward. Neither replay nor a snapshot fetched before deletion can reactivate that Clerk ID; a genuinely new registration has a new provider ID.

Bootstrap supplies a worktree-local Clerk webhook signing secret when none is provided, including with `--no-polar`; it does not register a hosted endpoint. Never point a hosted endpoint at a generated local secret unless an explicit development forwarder uses it. Hosted setup is in [deployment](../deployment.md#hosted-webhooks).
