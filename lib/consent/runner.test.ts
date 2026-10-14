import { describe, expect, test } from "vitest";
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
