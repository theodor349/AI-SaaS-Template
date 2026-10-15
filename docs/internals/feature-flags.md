# Feature flags

Flags let unfinished or risky work merge turned off, or turned on only for the maintainer and selected users, and be switched without a deploy. They are deliberately simple: no percentage rollouts, experiments, or third-party service.

Flags are declared in the [registry](../../convex/lib/featureFlags.ts) with a default and a description. Keys are typed, so deleting a flag there makes `pnpm lint` fail at every remaining use. Remove the uses, then delete the flag's row from each deployment. A leftover row is ignored, but it would apply again if a flag with the same key were added later.

## Evaluation

A flag's value comes from its `featureFlags` row: an `override` turns it on or off for everyone, including allowlisted users, so it also works as a kill switch. Without an override, users on the `allowlist` get the flag and everyone else, signed-out callers included, gets the registry default. A flag without a row uses its default.

Hiding UI is not access control. Every backend function behind a flag calls `requireFlag(ctx, key)`, which throws `FEATURE_UNAVAILABLE`, or branches on `isFlagEnabled(ctx, key)`. Both record a `feature_flag` decision in the function's wide event.

Components read flags with [`useFlag(key)`](../../lib/feature-flags.ts). All of them share one subscription to `featureFlags.current`, which returns only the caller's values, never another user's allowlist membership. Don't add per-flag queries.

## Changing a flag

Edit the `featureFlags` table in the Convex dashboard (one row per flag: `key`, optional `override`, optional `allowlist` of `users` IDs), or run the internal mutations. Add `--prod` or `--deployment <name>` to target a hosted deployment:

```sh
pnpm exec convex run featureFlags:setOverride '{"key":"exampleFeature","enabled":true}'   # on for everyone
pnpm exec convex run featureFlags:setOverride '{"key":"exampleFeature","enabled":null}'   # remove the override
pnpm exec convex run featureFlags:allowUser '{"key":"exampleFeature","userId":"<users _id>"}'
pnpm exec convex run featureFlags:disallowUser '{"key":"exampleFeature","userId":"<users _id>"}'
```

User IDs are `users._id` values, found in the dashboard's `users` table. The mutations reject unknown keys and users, and delete the row once it holds no state. Keep the allowlist to a handful of users, because every flag read loads the whole row.
