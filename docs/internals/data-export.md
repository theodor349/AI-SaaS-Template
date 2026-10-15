# Data export

The account page's **Export your data** card downloads the caller's data as one JSON file, for GDPR access (Art. 15) and portability (Art. 20). Every feature that stores user data contributes a section. The account page never changes when one is added.

## Registering a feature

A feature defines its exporter next to its own functions, built with `exportOne` and `exportMany` from [`convex/lib/dataExport.ts`](../../convex/lib/dataExport.ts), and adds one line to the registry in [`convex/dataExport.ts`](../../convex/dataExport.ts). [`billingExport`](../../convex/billing.ts) shows both kinds of part.

Each part's validator is the published shape. Export rows pass through `parse`, which drops fields the validator doesn't declare, so a whole document returned by mistake still can't leak internal fields. Export what the user would recognize as theirs. Leave out sign-in and provider identifiers that link accounts, leases, retry and sync bookkeeping, and secrets. Timestamps are ISO strings. Bump `formatVersion` when a shape changes incompatibly, since people may keep these files and parse them later.

Exporters receive the owner resolved from the caller's identity and must read only rows reachable from it, through an index. Add the section to [`dataExport.test.ts`](../../convex/dataExport.test.ts), which checks another user's records and internal fields never appear.

## Size limits

The `download` action collects each part a page at a time through an internal query. Each page is its own transaction, so a large list never hits a query's read limits. The action then returns the whole file as a JSON string. A string is used because Convex arrays hold at most 8192 values. The cost is that the export isn't one point-in-time snapshot.

The ceiling is Convex's 16 MiB function result. Over 12 MiB, the action fails with `EXPORT_TOO_LARGE`, and the card points the user to support. Today's largest realistic export is billing history, which reconciliation caps at 1000 orders and 100 subscriptions, well under 1 MiB. A feature whose largest realistic dataset could approach the ceiling should move the export to a generated file in Convex storage, deleted shortly after its download URL is used. Size it before the feature ships.
