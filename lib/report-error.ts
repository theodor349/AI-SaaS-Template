// Every error boundary calls this once for each error it catches. It does nothing
// until error reporting is connected.
export function reportError(_error: Error & { digest?: string }) {}
