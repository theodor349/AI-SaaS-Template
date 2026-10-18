import { cn } from "@/lib/utils";
import styles from "./misplaced-square.module.css";

// The Just Enough Solutions logo with its light square out of place. "missing" misses
// the gap on the 404 page; "popped" has knocked it loose, and `snapped` puts it back
// while the page retries; "lifted" holds it above the gap during maintenance. Each
// animates once on mount and is static with reduced motion.
// Colors come from theme tokens, which global-error defines for itself.
export function MisplacedSquare({ variant, snapped = false }: {
  variant: "missing" | "popped" | "lifted";
  snapped?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 140 100"
      className={cn(styles.illustration, styles[variant], snapped && styles.snapped)}
    >
      <path className={styles.mark} d="M20 20 H 80 V 50 H 50 V 80 H 20 Z" />
      <rect className={styles.slot} x="51" y="51" width="28" height="28" />
      <rect className={styles.square} x="50" y="50" width="30" height="30" />
    </svg>
  );
}
