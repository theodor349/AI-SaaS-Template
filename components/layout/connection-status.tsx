"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useConvex } from "convex/react";
import styles from "./connection-status.module.css";

// Disconnects shorter than this, including the first connection, show nothing.
const CONNECTION_GRACE_MS = 2000;

const labels = { offline: "Offline…", connecting: "Connecting…", reconnecting: "Reconnecting…" };

// A corner indicator that tells users live data has stopped updating because the Convex
// WebSocket is down. Render once, in the root layout, under the Convex provider.
export function ConnectionStatus() {
  const status = useConnectionStatus();
  const disconnected = status !== "connected";
  // Each disconnect starts a new grace period; `wasShown` lets the reconnect be announced.
  const [episode, setEpisode] = useState({ disconnected, overdue: false, wasShown: false });
  if (episode.disconnected !== disconnected) {
    setEpisode({ disconnected, overdue: false, wasShown: episode.overdue });
  }

  useEffect(() => {
    if (!disconnected) return;
    const timer = setTimeout(() => setEpisode((current) => ({ ...current, overdue: true })), CONNECTION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [disconnected]);

  // The live region stays mounted so screen readers announce its changes politely.
  return (
    <div role="status" className={styles.region}>
      {status !== "connected" && episode.overdue && (
        <p className={styles.indicator}>
          <span aria-hidden="true" className={styles.light} />
          {labels[status]}
        </p>
      )}
      {!disconnected && episode.wasShown && <span className="sr-only">Back online</span>}
    </div>
  );
}

// The browser's offline flag answers at once; Convex alone only notices a dead socket
// once it fails or the server goes quiet. Convex covers a backend the browser can't reach.
function useConnectionStatus() {
  const convex = useConvex();
  const socket = useSyncExternalStore(
    (onChange) => convex.subscribeToConnectionState(onChange),
    () => {
      const { isWebSocketConnected, hasEverConnected } = convex.connectionState();
      if (isWebSocketConnected) return "connected";
      return hasEverConnected ? "reconnecting" : "connecting";
    },
    () => "connected" as const,
  );
  const online = useSyncExternalStore(subscribeToOnline, () => navigator.onLine, () => true);
  return online ? socket : "offline";
}

function subscribeToOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
