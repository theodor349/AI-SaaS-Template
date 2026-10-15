import type { ConsentStorage } from "./service";

// Removes a withdrawn service's first-party cookies and web storage. Cookies on the
// provider's own domain are out of reach; withdrawal stops the service from using them.
// Browsers that block storage throw; each entry is cleared independently.
export function clearConsentStorage(storage: readonly ConsentStorage[]) {
  for (const item of storage) {
    try {
      if (item.type === "cookie") expireCookie(item.name);
      else if (item.type === "cacheStorage") void caches.delete(item.name).catch(() => {});
      else window[item.type].removeItem(item.name);
    } catch {
      // Blocked storage holds nothing this service could have written.
    }
  }
}

// A cookie set for a parent domain only goes away with that Domain attribute, so
// expire it on this host and each parent.
function expireCookie(name: string) {
  const labels = window.location.hostname.split(".");
  const domains = [undefined, ...labels.slice(0, -1).map((_, index) => labels.slice(index).join("."))];
  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`;
  }
}
