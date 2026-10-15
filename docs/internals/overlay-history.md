# Overlay history

An installed app has no browser back button, and Android's back gesture is a history back. So that the gesture closes an open dialog or menu instead of leaving the page, each open overlay owns one history entry above the page's entry ([lib/overlay-history.ts](../../lib/overlay-history.ts)). The shared `Dialog`, `AlertDialog`, and `DropdownMenu` roots in `components/ui` register themselves through [useOverlayState](../../components/overlay/use-overlay-state.ts). An overlay built on a Radix root directly, or a third-party one such as Clerk's sign-in modal, gets none of this; build new overlays on the shared roots.

Browsers behave the same way, so desktop back also closes the top overlay first. Chrome's `CloseWatcher` would handle the gesture without history, but it doesn't respond to history back, the only thing tests and other browsers can drive.

## Traps the module handles

- **Next.js treats every `popstate` as a back navigation** and discards any navigation in progress. When an overlay closes in the page, the module steps back over its entry itself, and its capture listener hides that `popstate` from Next.js. Without this, choosing a link in a menu could leave the user on the old page.
- **History writes wait for that step to land.** A `history.back()` lands asynchronously, and a `pushState` in the meantime can strand the overlay's entry above the new page. The module wraps `pushState` and `replaceState` and queues writes until its own step lands, which is also how a dialog opened from a menu takes over the menu's entry.
- **A navigation while an overlay is still open replaces the overlay's entries** and closes the overlay, so back from the new page returns to the old one in a single step.

Forward after closing an overlay with back lands on that overlay's old entry, which shows the same page. That entry can't be removed without adding another, so it is left in place.
