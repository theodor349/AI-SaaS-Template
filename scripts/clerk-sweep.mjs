import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkoutRoots, formatDuration, parseDuration } from "./agent-cli.mjs";
import { worktreeConfig, worktreeCredentials } from "./bootstrap.mjs";
import { clerkBackend, TEST_USER_PURPOSES, withProviderRetry } from "./clerk-test-user.mjs";

const usage = "Usage: pnpm clerk:sweep [--older-than <duration>] [--all-worktrees] [--dry-run]";
export const DEFAULT_MAX_AGE_MS = { "local-agent-test": 2 * 3_600_000, "maintainer-review": 7 * 86_400_000 };
const pageSize = 500;

export function sweepOptions(argv) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    "older-than": { type: "string" }, "all-worktrees": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false }, help: { type: "boolean" },
  } });
  if (values.help) return { help: true };
  return {
    olderThanMs: values["older-than"] === undefined ? null : parseDuration(values["older-than"], "--older-than"),
    allWorktrees: values["all-worktrees"], dryRun: values["dry-run"],
  };
}

// Only labeled resources from generated +clerk_test addresses are ever selected.
export function selectSweep({ users, organizations }, { now, worktreeId, olderThanMs }) {
  const result = { users: [], organizations: [], labeled: 0, otherWorktree: 0, tooRecent: 0 };
  const consider = (kind, resource, metadata) => {
    const purpose = metadata?.purpose;
    if (kind === "users" ? !TEST_USER_PURPOSES.includes(purpose) : purpose !== "local-agent-test") return;
    if (kind === "users") {
      const emails = resource.emailAddresses ?? [];
      if (!emails.length || !emails.every(({ emailAddress }) => emailAddress?.includes("+clerk_test@"))) return;
    }
    const owner = metadata.WORKTREE_ID;
    if (typeof owner !== "string" || !/^wt-[0-9a-f]{12}$/.test(owner)) return;
    result.labeled++;
    if (worktreeId !== null && owner !== worktreeId) {
      result.otherWorktree++;
      return;
    }
    const ageMs = now - resource.createdAt;
    if (!(ageMs >= (olderThanMs ?? DEFAULT_MAX_AGE_MS[purpose]))) {
      result.tooRecent++;
      return;
    }
    result[kind].push({ id: resource.id, purpose, worktreeId: owner, ageMs });
  };
  for (const user of users) consider("users", user, user.publicMetadata);
  for (const organization of organizations) consider("organizations", organization, organization.privateMetadata);
  return result;
}

async function listAll(fetchPage) {
  const byId = new Map();
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await withProviderRetry(() => fetchPage({ limit: pageSize, offset, orderBy: "+created_at" }));
    for (const item of data) byId.set(item.id, item);
    if (data.length < pageSize) return [...byId.values()];
  }
}

function describe({ id, purpose, worktreeId, ageMs }) {
  return `  ${id}  ${purpose}  ${worktreeId}  ${formatDuration(ageMs)} old`;
}

async function main() {
  const options = sweepOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`${usage}\n\nDeletes orphaned Clerk test users and organizations created by tests, inspect, capture, and review-link.\nDefaults to this worktree; local-agent-test resources older than 2h and maintainer-review users older than 7d.\n--older-than     One age for every purpose, such as 0s to clean this worktree in CI.\n--all-worktrees  Include labeled resources from every worktree.\n--dry-run        List what would be deleted without deleting it.`);
    return;
  }
  // Only Clerk credentials are needed, so this also works while bootstrap is stopped.
  const { root, mainRoot } = checkoutRoots();
  const config = worktreeConfig(root);
  const client = clerkBackend(worktreeCredentials(root, mainRoot, false));
  const users = await listAll((params) => client.users.getUserList(params));
  let organizations;
  try {
    organizations = await listAll((params) => client.organizations.getOrganizationList(params));
  } catch (error) {
    if (!error.errors?.some((detail) => detail.code === "organization_not_enabled_in_instance")) throw error;
    organizations = [];
  }
  const selection = selectSweep({ users, organizations },
    { now: Date.now(), worktreeId: options.allWorktrees ? null : config.id, olderThanMs: options.olderThanMs });
  const scope = options.allWorktrees ? "all worktrees" : `worktree ${config.id}`;
  const ages = options.olderThanMs === null
    ? Object.entries(DEFAULT_MAX_AGE_MS).map(([purpose, age]) => `${purpose} older than ${formatDuration(age)}`).join(", ")
    : `older than ${formatDuration(options.olderThanMs)}`;
  console.log(`Clerk sweep${options.dryRun ? " (dry run)" : ""} for ${scope}: ${ages}.`);
  console.log(`Scanned ${users.length} users and ${organizations.length} organizations; ${selection.labeled} are labeled test resources (${selection.otherWorktree} from other worktrees, ${selection.tooRecent} too recent).`);
  const verb = options.dryRun ? "Would delete" : "Deleting";
  const failed = [];
  for (const [kind, remove] of [
    ["organizations", (id) => client.organizations.deleteOrganization(id)],
    ["users", (id) => client.users.deleteUser(id)],
  ]) {
    const selected = selection[kind];
    console.log(`${verb} ${selected.length} ${selected.length === 1 ? kind.slice(0, -1) : kind}${selected.length ? ":" : "."}`);
    for (const item of selected) {
      console.log(describe(item));
      if (options.dryRun) continue;
      try {
        await withProviderRetry(() => remove(item.id));
      } catch (error) {
        if (error.status !== 404) failed.push(item.id);
      }
    }
  }
  if (failed.length) throw new Error(`Could not delete ${failed.join(", ")}. Run pnpm clerk:sweep again later.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Clerk sweep: ${error.message}`);
    process.exitCode = 1;
  });
}
