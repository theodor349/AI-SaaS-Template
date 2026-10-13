import { env } from "../_generated/server";

// Clerk Backend API calls for one user, used from actions. Callers treat a
// thrown error as retryable; the errors carry no provider data.
function clerkUserRequest(clerkId: string, method: "GET" | "DELETE") {
  if (!env.CLERK_SECRET_KEY) throw new Error("Clerk configuration missing");
  return fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}`, {
    method,
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
}

// Returns the unvalidated user payload; parse it with `parseClerkProfile`.
export async function fetchClerkUser(clerkId: string): Promise<unknown> {
  const response = await clerkUserRequest(clerkId, "GET");
  // A 404 can mean the Backend API key belongs to another Clerk instance.
  // Only signed deletion events may create terminal lifecycle requests.
  if (!response.ok) throw new Error("Provider request failed");
  return response.json();
}

// An identity that is already gone counts as deleted.
export async function deleteClerkUser(clerkId: string) {
  const response = await clerkUserRequest(clerkId, "DELETE");
  if (!response.ok && response.status !== 404) throw new Error("Identity deletion failed");
}
