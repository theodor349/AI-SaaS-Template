import type { Page } from "@playwright/test";
import type { JSONValue } from "convex/values";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

// Intercepts the browser's Convex sync WebSocket so a test can answer actions,
// hold authentication or backend responses, and observe query subscriptions while
// every other message still reaches this worktree's backend.
//
// This is the only E2E code that depends on Convex's private wire protocol
// (convex/src/browser/sync/protocol.ts). If a Convex upgrade breaks these tests,
// compare the frame types below with that file and fix them here.

type ClientFrame =
  | { type: "Action"; requestId: number; udfPath: string; args: [JSONValue] }
  | { type: "Authenticate"; tokenType: "User" | "Admin" | "None" }
  | { type: "ModifyQuerySet"; modifications: Array<{ type: "Add"; queryId: number; udfPath: string } | { type: "Remove"; queryId: number }> }
  | { type: "Other" };
type ServerFrame =
  | { type: "Transition"; modifications: Array<{ type: string; queryId: number; value?: JSONValue }> }
  | { type: "Other" };

export type ActionCall<Args> = {
  args: Args;
  /** Resolves the browser's call with `result` without running the backend action. */
  succeed: (result: JSONValue, logLines?: string[]) => void;
  /** Rejects the browser's call with `message` without running the backend action. */
  fail: (message: string) => void;
  /** Sends the original request on to the backend. */
  forward: () => void;
};

export async function interceptConvexSync(page: Page) {
  const backendHost = new URL(resolveLocalTestConfig().config.env.NEXT_PUBLIC_CONVEX_URL).host;
  const actions = new Map<string, (call: ActionCall<never>) => void | Promise<void>>();
  const subscribed = new Set<string>();
  const replacements = new Map<string, JSONValue>();
  const heldAuthentication: Array<() => void> = [];
  const heldResponses: Array<() => void> = [];
  let holdingAuthentication = false;
  let holdingResponses = false;
  let holdResponsesFrom: string | undefined;

  await page.routeWebSocket((url) => url.host === backendHost && url.pathname.endsWith("/sync"), (socket) => {
    const server = socket.connectToServer();
    // Query IDs are per connection; a reconnect starts a new query set.
    const queryPaths = new Map<number, string>();

    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as ClientFrame;
      const forward = () => server.send(message);
      if (frame.type === "ModifyQuerySet") {
        for (const modification of frame.modifications) {
          if (modification.type === "Add") {
            queryPaths.set(modification.queryId, modification.udfPath);
            subscribed.add(modification.udfPath);
          } else {
            queryPaths.delete(modification.queryId);
          }
        }
      }
      if (frame.type === "Authenticate" && frame.tokenType !== "None" && holdingAuthentication) {
        heldAuthentication.push(forward);
        return;
      }
      const handler = frame.type === "Action" ? actions.get(frame.udfPath) : undefined;
      if (frame.type !== "Action" || !handler) {
        forward();
        return;
      }
      // Only the first answer counts, so tests can release a call more than once.
      let answered = false;
      const answer = (send: () => void) => {
        if (answered) return;
        answered = true;
        send();
      };
      const respond = (response: { success: true; result: JSONValue; logLines: string[] } | { success: false; result: string; logLines: string[] }) =>
        answer(() => socket.send(JSON.stringify({ type: "ActionResponse", requestId: frame.requestId, ...response })));
      void handler({
        args: frame.args[0] as never,
        succeed: (result, logLines = []) => respond({ success: true, result, logLines }),
        fail: (result) => respond({ success: false, result, logLines: [] }),
        forward: () => answer(forward),
      });
    });

    server.onMessage((message) => {
      let text = message.toString();
      if (replacements.size || holdResponsesFrom) {
        const frame = JSON.parse(text) as ServerFrame;
        const updated = frame.type === "Transition"
          ? frame.modifications.filter((modification) => modification.type === "QueryUpdated")
          : [];
        for (const modification of updated) {
          const path = queryPaths.get(modification.queryId);
          if (path && replacements.has(path)) modification.value = replacements.get(path)!;
        }
        if (holdResponsesFrom && updated.some((modification) => queryPaths.get(modification.queryId) === holdResponsesFrom)) {
          holdingResponses = true;
        }
        if (replacements.size) text = JSON.stringify(frame);
      }
      if (holdingResponses) heldResponses.push(() => socket.send(text));
      else socket.send(text);
    });
  });

  return {
    /** Handles every browser call to the action at `udfPath`, such as "billing/polar:checkout". */
    onAction: <Args = Record<string, JSONValue>,>(udfPath: string, handler: (call: ActionCall<Args>) => void | Promise<void>) => {
      actions.set(udfPath, handler);
    },
    /** Whether the browser has subscribed to the query at `udfPath`. */
    hasSubscribed: (udfPath: string) => subscribed.has(udfPath),
    /** Replaces every result the backend sends for the query at `udfPath`. */
    replaceQueryResult: (udfPath: string, value: JSONValue) => {
      replacements.set(udfPath, value);
    },
    /** Holds token authentication, so the client stays unauthenticated until released. */
    holdAuthentication: () => {
      holdingAuthentication = true;
    },
    releaseAuthentication: () => {
      holdingAuthentication = false;
      heldAuthentication.splice(0).forEach((send) => send());
    },
    /**
     * Holds backend messages until released. With `udfPath`, holding starts at the
     * first result for that query; later messages wait too, preserving their order.
     */
    holdResponses: (udfPath?: string) => {
      if (udfPath) holdResponsesFrom = udfPath;
      else holdingResponses = true;
    },
    pendingResponses: () => heldResponses.length,
    releaseResponses: () => {
      holdingResponses = false;
      holdResponsesFrom = undefined;
      heldResponses.splice(0).forEach((send) => send());
    },
  };
}
