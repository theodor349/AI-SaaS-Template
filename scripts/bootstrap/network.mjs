import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { portBlockHelp } from "./config.mjs";

// macOS can allow a loopback bind beside an existing wildcard listener, so a
// successful connection counts as occupied even when a bind would succeed.
export function portAcceptsConnections(port, service = "service") {
  return new Promise((resolvePort, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(2000, () => socket.destroy(new Error(`Timed out checking ${service} port ${port}.`)));
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolvePort(false) : reject(error));
  });
}

export async function assertPortsAvailable(ports) {
  for (const [service, port] of Object.entries(ports)) {
    const occupied = () => new Error(`${service} port ${port} is occupied. Stop the other process, or ${portBlockHelp}.`);
    if (await portAcceptsConnections(port, service)) throw occupied();
    await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", () => reject(occupied()));
      server.listen(port, "127.0.0.1", () => server.close(resolvePort));
    });
  }
}

export async function occupiedPorts(ports) {
  const occupied = [];
  for (const [service, port] of Object.entries(ports)) {
    if (await portAcceptsConnections(port, service).catch(() => true)) occupied.push(`${service} ${port}`);
  }
  return occupied;
}

export async function waitForServer(url, signal) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(250, undefined, { signal });
  }
  throw new Error(`Timed out waiting for ${url}.`);
}
