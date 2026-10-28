// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { appError } from "@/convex/lib/errors";
import { onCall, resetConvex, setQuery } from "@/tests/component/fake-convex";
import { click, getByRole, render } from "@/tests/component/render";
import { DataExport } from "./data-export";

vi.mock("convex/react", () => import("@/tests/component/fake-convex"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), SignInButton: () => null }));

beforeEach(() => {
  resetConvex();
  setQuery(api.account.users.current, {
    status: "ready", user: { id: "user" as Id<"users">, email: "export@example.test", displayName: null },
  });
});

test("repeated exports say when the user can export again", async () => {
  // The backend's answer once the burst is used up; convex/account/dataExport.test.ts covers the limit.
  onCall(api.account.dataExport.download, () => {
    throw appError("RATE_LIMITED", { retryAfter: 9.5 * 60_000 });
  });
  const { container } = render(<DataExport />);

  await click(getByRole("button", "Export data"));
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Couldn’t export your data");
  expect(alert?.textContent).toContain("Please wait 10 minutes before trying again.");
  expect(getByRole("button", "Export data")).toHaveProperty("disabled", false);
});
