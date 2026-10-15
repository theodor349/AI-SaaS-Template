import type { Consent } from "./cookie";
import type { ConsentService, ConsentStorage } from "./service";

// Loads services whose category is granted and unloads them when it is withdrawn,
// clearing the storage they listed. Create one per page lifetime; it remembers what
// it loaded, so calling sync again with the same consent does nothing.
export function createConsentRunner(services: readonly ConsentService[], clear: (storage: readonly ConsentStorage[]) => void) {
  // Each grant records its own attempt, so a failed load forgets only itself and a
  // later sync retries it, while a newer grant's record survives.
  const loaded = new Map<string, object>();
  // Each service's transitions run in order, so a withdrawal waits for its pending load.
  const queues = new Map<string, Promise<void>>();

  function enqueue(service: ConsentService, step: () => void | Promise<void>) {
    const queue = (queues.get(service.id) ?? Promise.resolve())
      .then(step)
      .catch((error: unknown) => console.error(`Consent service ${service.id} failed to change state`, error));
    queues.set(service.id, queue);
    return queue;
  }

  // Resolves once every transition this call started has finished.
  async function sync(consent: Consent | null) {
    const transitions: Promise<void>[] = [];
    for (const service of services) {
      if (service.category === "essential") continue;
      if (consent?.choices[service.category] === true) {
        if (loaded.has(service.id)) continue;
        const attempt = {};
        loaded.set(service.id, attempt);
        transitions.push(enqueue(service, async () => {
          try {
            await service.load?.();
          } catch (error) {
            if (loaded.get(service.id) === attempt) loaded.delete(service.id);
            throw error;
          }
        }));
        continue;
      }
      // Not granted: also clears what an earlier visit may have left behind.
      const wasLoaded = loaded.delete(service.id);
      transitions.push(enqueue(service, async () => {
        if (wasLoaded) await service.unload?.();
        clear(service.storage);
      }));
    }
    await Promise.all(transitions);
  }

  return { sync };
}
