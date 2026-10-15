import { describe, expect, test, vi } from "vitest";
import { allChoices, CONSENT_POLICY_VERSION, type Consent } from "./cookie";
import { createConsentRunner } from "./runner";
import { defineConsentService, servicesByCategory, type ConsentStorage } from "./service";
import { consentServices } from "./services";

const consent = (analytics: boolean): Consent =>
  ({ version: CONSENT_POLICY_VERSION, choices: { ...allChoices(false), analytics }, decidedAt: new Date().toISOString() });

// A second analytics service, defined the same way as a real one.
function testService(events: string[], loadDelay = Promise.resolve()) {
  return defineConsentService({
    id: "test-analytics",
    category: "analytics",
    name: "Test Analytics",
    purpose: "Counts visits in tests.",
    storage: [{ name: "test_visitor", type: "localStorage", purpose: "Visitor ID.", duration: "1 year" }],
    async load() { await loadDelay; events.push("load"); },
    unload() { events.push("unload"); },
  });
}

function runnerFor(events: string[], loadDelay?: Promise<void>) {
  const cleared: (readonly ConsentStorage[])[] = [];
  const service = testService(events, loadDelay);
  const runner = createConsentRunner([...consentServices.filter((s) => s.category === "essential"), service], (storage) => {
    cleared.push(storage);
    events.push("clear");
  });
  return { runner, cleared, service };
}

describe("consent runner", () => {
  test("loads once when granted, then unloads and clears its storage when withdrawn", async () => {
    const events: string[] = [];
    const { runner, cleared, service } = runnerFor(events);
    await runner.sync(consent(true));
    await runner.sync(consent(true));
    expect(events).toEqual(["load"]);
    await runner.sync(consent(false));
    expect(events).toEqual(["load", "unload", "clear"]);
    expect(cleared).toEqual([service.storage]);
    await runner.sync(consent(true));
    expect(events).toEqual(["load", "unload", "clear", "load"]);
  });

  test("never loads without a choice, and clears storage an earlier visit left", async () => {
    const events: string[] = [];
    const { runner } = runnerFor(events);
    await runner.sync(null);
    expect(events).toEqual(["clear"]);
  });

  test("a withdrawal during a pending load unloads after the load finishes", async () => {
    const events: string[] = [];
    let finishLoad = () => {};
    const { runner } = runnerFor(events, new Promise((resolve) => { finishLoad = resolve; }));
    const granted = runner.sync(consent(true));
    const withdrawn = runner.sync(consent(false));
    finishLoad();
    await Promise.all([granted, withdrawn]);
    expect(events).toEqual(["load", "unload", "clear"]);
  });

  test("a failed load is retried by the next sync that still grants it", async () => {
    const events: string[] = [];
    let attempts = 0;
    const service = defineConsentService({
      id: "flaky", category: "analytics", name: "Flaky", purpose: "Fails once.", storage: [],
      load() {
        attempts += 1;
        if (attempts === 1) throw new Error("chunk failed to load");
        events.push("load");
      },
    });
    const runner = createConsentRunner([service], () => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await runner.sync(consent(true));
    expect(errors).toHaveBeenCalledOnce();
    await runner.sync(consent(true));
    expect(events).toEqual(["load"]);
    errors.mockRestore();
  });

  test("a load that fails after starting work is unloaded once, and a later withdrawal does not unload it again", async () => {
    const events: string[] = [];
    const service = defineConsentService({
      id: "partial", category: "analytics", name: "Partial", purpose: "Starts, then fails.", storage: [],
      load() {
        events.push("start");
        throw new Error("failed after starting");
      },
      unload() { events.push("unload"); },
    });
    const runner = createConsentRunner([service], () => events.push("clear"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await runner.sync(consent(true));
    await runner.sync(consent(false));
    expect(events).toEqual(["start", "unload", "clear"]);
    errors.mockRestore();
  });

  test("an older failed load does not forget a newer grant", async () => {
    const events: string[] = [];
    let failFirst = (_error: Error) => {};
    let attempts = 0;
    const service = defineConsentService({
      id: "racy", category: "analytics", name: "Racy", purpose: "Slow first load.", storage: [],
      load() {
        attempts += 1;
        if (attempts === 1) return new Promise<void>((_, reject) => { failFirst = reject; });
        events.push("load");
      },
      unload() { events.push("unload"); },
    });
    const runner = createConsentRunner([service], () => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = [runner.sync(consent(true)), runner.sync(consent(false)), runner.sync(consent(true))];
    await vi.waitFor(() => expect(attempts).toBe(1));
    failFirst(new Error("chunk failed to load"));
    await Promise.all(pending);
    await runner.sync(consent(false));
    expect(events).toEqual(["unload", "load", "unload"]);
    errors.mockRestore();
  });

  test("never loads or clears essential services", async () => {
    const events: string[] = [];
    const essential = defineConsentService({
      id: "essential-test", category: "essential", name: "Essential", purpose: "Always on.", storage: [],
      load() { events.push("essential load"); },
    });
    await createConsentRunner([essential], () => events.push("clear")).sync(null);
    expect(events).toEqual([]);
  });
});

describe("service registry", () => {
  test("a new service appears under its category with no other changes", () => {
    const service = testService([]);
    const sections = servicesByCategory([...consentServices, service]);
    expect(sections.map((section) => section.category)).toEqual(["essential", "analytics"]);
    expect(sections.find((section) => section.category === "analytics")?.services.map((s) => s.id))
      .toEqual(["sentry", "test-analytics"]);
  });
});
