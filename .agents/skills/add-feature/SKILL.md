---
name: add-feature
description: Checklist for adding a product feature with its own data, such as a paid CRUD feature, and the steps to remove the Notes reference feature. Use when building a new feature, renaming Notes into a project's first feature, or deleting Notes from a downstream project.
---

# Add a feature

Notes is the reference feature: [convex/notes](../../../convex/notes/notes.ts), the [`/app` page](../../../app/(protected)/app/page.tsx) and its `note-*` components, and [the E2E spec](../../../tests/e2e/notes.spec.mts). Copy its patterns, or rename it into your first feature. Every feature with user data touches each item below; the links show where Notes does it.

## Backend

- [ ] Read `convex/_generated/ai/guidelines.md`. Put the feature in its own `convex/<feature>/` folder with its helpers and tests.
- [ ] Register functions with the builders in [convex/lib/functions.ts](../../../convex/lib/functions.ts) so each call emits a wide event. Record the IDs a function acts on with `ctx.log.set` ([docs/internals/logging.md](../../../docs/internals/logging.md)).
- [ ] Guard every public function. Paid features call `requirePro(ctx)` in queries and `requirePro(ctx, Date.now())` in mutations; free features call `requireUser`. The user always comes from the identity, never from an argument.
- [ ] Check ownership of every document read or written by ID. Answer another user's ID exactly like a missing one, as `ownNote` does.
- [ ] Add a table to [convex/schema.ts](../../../convex/schema.ts) with an index for each query, owner first. Paginate lists; never `.collect()` a user's rows.
- [ ] Validate input on the server and throw typed codes added to [convex/lib/errors.ts](../../../convex/lib/errors.ts). Keep limits in a module the client can import too, like [convex/notes/validation.ts](../../../convex/notes/validation.ts), so `maxLength` matches the server.
- [ ] Delete the user's rows on account erasure: a bounded batch helper like `eraseNotes`, called from `erase` in [convex/account/lifecycle.ts](../../../convex/account/lifecycle.ts), which returns `false` while rows remain.
- [ ] Register an exporter in [convex/account/dataExport.ts](../../../convex/account/dataExport.ts) ([docs/internals/data-export.md](../../../docs/internals/data-export.md)) and name the new data in the export card's description.
- [ ] Rate-limit actions that call a paid or external provider through [convex/rateLimits.ts](../../../convex/rateLimits.ts).
- [ ] Register any third-party browser service, SDK, or optional cookie in the [consent registry](../../../lib/consent/services.ts) ([docs/internals/consent.md](../../../docs/internals/consent.md)).
- [ ] Put unfinished parts behind a [feature flag](../../../docs/internals/feature-flags.md). `setPinned` calls `requireFlag`, `list` branches on `isFlagEnabled`, and `NotePinButton` reads `useFlag`. A flag that switches a paginated query's index restarts the list from its first page when it changes.

## Frontend

- [ ] The page composes the feature's components; each component calls its own Convex hooks. Notes uses `usePaginatedQuery` with a "Load more" button.
- [ ] Each component owns a skeleton shaped like its loaded state, and the page shell stays visible while it loads. Show an empty state.
- [ ] Use `useMutation` from `lib/convex`. Buttons show progress with `ButtonLabel` and block repeats while pending. Show validation errors next to their field and other failures inline; let the updated UI confirm success.
- [ ] Confirm destructive actions in an `AlertDialog`. Build overlays on the shared `components/ui` roots so back closes them.

## Tests

- [ ] convex-test covering the happy path, another user's ID on every by-ID function, the paid or auth guard, validation codes, flag gating, and erasure across more than one batch ([convex/notes/notes.test.ts](../../../convex/notes/notes.test.ts)).
- [ ] An E2E spec for the main flow and the unpaid redirect, using the billing fixtures in `scripts/billing-test-fixtures.mjs`. `pnpm test:e2e` picks it up, so it also runs in the full suite. Tag the main flow `@critical`, as Notes does, so the nightly run covers it. Add an area for the feature's paths and spec to [`tests/e2e/spec-map.json`](../../../tests/e2e/spec-map.json), so pull request runs select the spec when the feature changes.
- [ ] Before/after captures of the loaded, empty, and skeleton states at desktop and mobile widths for the PR.

# Remove Notes

Removing Notes leaves `/app` with its heading and welcome line. In an app that replaced `/app` with its own page, as Rekura did with `/lists`, the page and its welcome line go too; see step 2.

1. Delete `convex/notes/`, `tests/e2e/notes.spec.mts`, and `app/(protected)/app/_components/note-*.tsx`, and remove the Notes area from `tests/e2e/spec-map.json`.
2. In `app/(protected)/app/page.tsx`, remove `NoteComposer` and `NoteList`, and rename the heading and `metadata.title`. Update the `"Notes"` heading in `tests/e2e/*.spec.mts` to match. If the app has no `/app` page, skip the page edits and delete `note-*.tsx` and `welcome.tsx` wherever they ended up. A template sync can move them into the app's renamed folder, such as `app/(protected)/lists/_components`. Keep the app's own heading in the E2E specs.
3. Remove the `notes` table from `convex/schema.ts`, and the `INVALID_NOTE_BODY`, `INVALID_NOTE_TITLE`, and `NOTE_NOT_FOUND` codes from `convex/lib/errors.ts`.
4. In `convex/account/lifecycle.ts`, remove the `eraseNotes` import and its block in `erase`.
5. In `convex/account/dataExport.ts`, remove `notesExport`. In `convex/account/dataExport.test.ts`, remove the seeded note and the expected `notes` section. Drop "notes" from the description in `app/(protected)/account/_components/data-export.tsx`.
6. Remove `notePinning` from `convex/lib/featureFlags.ts`. `convex/featureFlags.test.ts`, `convex/maintenance.test.ts`, and the commands in `docs/internals/feature-flags.md` need a flag that is off by default: use another flag, or add `exampleFeature: { default: false, description: "Template example. Replace it with your first real flag." }`, and point them at it.
7. This skill uses Notes as its reference, so delete `.agents/skills/add-feature/`, its `.claude/skills/add-feature` link, and its line in `AGENTS.md`. The migrate-app and sync-template skills link here; change those links to say to read the template's copy with `git show template/main:.agents/skills/add-feature/SKILL.md`. To keep the checklist instead, point its links at the app's own first feature.
8. In every deployment that has Notes data, clear the `notes` table and delete the `notePinning` row from `featureFlags`. Dropping the table from the schema does not delete its documents.
9. Run `pnpm test:unit`, `pnpm lint`, and `pnpm build`, then search the repo for `notes`, `notePinning`, and `add-feature` to catch anything left behind.
