import { describe, expect, test } from "vitest";
import source from "../../public/sw.js?raw";

type Handler = (event: FakeEvent) => void;
type FakeEvent = {
  request?: Request;
  preloadResponse?: Promise<Response | undefined>;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
};

// Runs public/sw.js as the browser does, with fakes for the worker globals it uses.
function loadServiceWorker({ network }: { network: (request: Request) => Promise<Response> }) {
  const handlers = new Map<string, Handler>();
  const stored = new Map<string, { request: Request; response: Response }>();
  const fetched: Request[] = [];
  const cache = {
    add: async (request: Request) => {
      fetched.push(request);
      stored.set(new URL(request.url).pathname, { request, response: await network(request) });
    },
  };
  const caches = {
    open: async () => cache,
    match: async (url: string) => stored.get(url)?.response.clone(),
  };
  const self = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: { navigationPreload: { enable: async () => {} } },
  };
  const fetch = (request: Request) => {
    fetched.push(request);
    return network(request);
  };
  // Request("/offline") needs a base URL, as it has in the browser.
  const OriginRequest = class extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, "https://app.example"), init);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the file is what ships.
  new Function("self", "caches", "fetch", "Request", source)(self, caches, fetch, OriginRequest);

  async function lifecycle(type: "install" | "activate") {
    const work: Promise<unknown>[] = [];
    handlers.get(type)!({ waitUntil: (promise) => work.push(promise) });
    await Promise.all(work);
  }

  // Resolves to the worker's response, or null when it leaves the request to the browser.
  async function request(url: string, { navigate = false } = {}) {
    const responses: Promise<Response>[] = [];
    const request = new Request(url);
    // The Fetch API forbids constructing navigation requests, so set the mode afterwards.
    if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
    handlers.get("fetch")!({
      request,
      preloadResponse: Promise.resolve(undefined),
      respondWith: (promise) => responses.push(promise),
      waitUntil: () => {},
    });
    return responses.length ? await responses[0] : null;
  }

  return { lifecycle, request, stored, fetched };
}

const offlinePage = () => new Response("<h1>You’re offline</h1>", { headers: { "Content-Type": "text/html" } });

describe("service worker", () => {
  test("installing caches only the offline page, fetched without cookies", async () => {
    const worker = loadServiceWorker({ network: async () => offlinePage() });
    await worker.lifecycle("install");
    expect([...worker.stored.keys()]).toEqual(["/offline"]);
    expect(worker.stored.get("/offline")!.request.credentials).toBe("omit");
  });

  test("an online navigation returns the network page and caches nothing", async () => {
    const worker = loadServiceWorker({ network: async (request) => new URL(request.url).pathname === "/offline" ? offlinePage() : new Response("billing") });
    await worker.lifecycle("install");
    const response = await worker.request("https://app.example/billing", { navigate: true });
    expect(await response!.text()).toBe("billing");
    expect([...worker.stored.keys()]).toEqual(["/offline"]);
  });

  test("a navigation that fails without a network shows the offline page", async () => {
    let online = true;
    const worker = loadServiceWorker({
      network: async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return offlinePage();
      },
    });
    await worker.lifecycle("install");
    online = false;
    const response = await worker.request("https://app.example/account", { navigate: true });
    expect(await response!.text()).toContain("You’re offline");
  });

  test("without a cached offline page, a failed navigation still gets a page", async () => {
    const worker = loadServiceWorker({ network: async () => { throw new TypeError("Failed to fetch"); } });
    const response = await worker.request("https://app.example/app", { navigate: true });
    expect(response!.status).toBe(503);
    expect(await response!.text()).toContain("You’re offline");
  });

  test("a server error passes through instead of the offline page", async () => {
    const worker = loadServiceWorker({ network: async () => new Response("down", { status: 503 }) });
    const response = await worker.request("https://app.example/app", { navigate: true });
    expect(response!.status).toBe(503);
  });

  test("API, provider, and static asset requests never pass through the worker", async () => {
    const worker = loadServiceWorker({ network: async () => new Response("ok") });
    for (const url of [
      "https://app.example/app?_rsc=1",
      "https://app.example/api/export",
      "https://app.example/_next/static/chunks/main.js",
      "https://clerk.app.example/v1/client",
      "https://happy-animal-123.convex.cloud/api/query",
      "https://sandbox-api.polar.sh/v1/checkouts",
      "https://o1.ingest.sentry.io/api/1/envelope/",
    ]) {
      expect(await worker.request(url)).toBeNull();
    }
    expect(worker.fetched).toEqual([]);
  });
});
