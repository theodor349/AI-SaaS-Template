# Data export

The account page's **Export your data** card downloads the caller's data as one JSON file, for GDPR access (Art. 15) and portability (Art. 20). Every feature that stores user data contributes a section. The account page never changes when one is added.

## Registering a feature

A feature defines its exporter next to its own functions, built with `exportOne` and `exportMany` from [`convex/lib/dataExport.ts`](../../convex/lib/dataExport.ts), and adds one line to the registry in [`convex/account/dataExport.ts`](../../convex/account/dataExport.ts). [`billingExport`](../../convex/billing/account.ts) shows both kinds of part.

Each part's validator is the published shape. Export rows pass through `parse`, which drops fields the validator doesn't declare, so a whole document returned by mistake still can't leak internal fields. Export what the user would recognize as theirs. Leave out sign-in and provider identifiers that link accounts, leases, retry and sync bookkeeping, and secrets. Timestamps are ISO strings. Bump `formatVersion` when a shape changes incompatibly, since people may keep these files and parse them later.

Exporters receive the owner resolved from the caller's identity and must read only rows reachable from it, through an index. Add the section to [`dataExport.test.ts`](../../convex/account/dataExport.test.ts), which checks another user's records and internal fields never appear.

## Delivery and size limits

The `download` action collects each part a page at a time through an internal query. Each page is its own transaction, so a large list never hits a query's read limits. The cost is that the export isn't one point-in-time snapshot.

The action writes the export to Convex file storage and returns the file's URL, which the card fetches and saves. A function result is capped at 16 MiB, but a stored file is not, and one app moving onto the template already has a user whose export is about 10 MiB. The action encodes each page as it arrives and stores the file from those chunks, so it never holds the whole export as one string. The JSON is compact, not pretty-printed.

A storage URL works for anyone who has it, and Convex can't expire one, so deleting the file is the only expiry. [`dataExportFiles.ts`](../../convex/account/dataExportFiles.ts) records each file against its owner and schedules its deletion 10 minutes later. Account erasure deletes any file still waiting. No public function accepts a file or storage ID, so a caller can only receive a URL for an export of their own data.

The action still holds the whole encoded file in memory before storing it, and action memory is 64 MiB in the default runtime. On a local backend a 57 MiB export fit and a 95 MiB export ran out of memory. Over 32 MiB the action fails with `EXPORT_TOO_LARGE` before it runs out, and the card points the user to support. If a realistic export could approach that ceiling, raise it only after measuring, or move the action to the Node runtime, which has more memory.
