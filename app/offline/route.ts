import { appConfig } from "@/app.config";
import { brandIconSrc } from "@/lib/brand-icon";
import { themeScript } from "@/lib/theme";

export const dynamic = "force-static";

// The page public/sw.js shows when a navigation fails without a network. It is
// served from the service worker's cache with nothing else, so it is one
// self-contained document: no Next.js scripts, stylesheets, fonts, Clerk, or
// Convex, only the inline theme script and the global error page's theme tokens.
// It reloads by itself when the connection comes back. Its scripts are inline, with no
// event handler attributes, for the Content Security Policy (lib/security/csp.ts).
export async function GET() {
  const appName = escapeHtml(appConfig.appName);
  const supportEmail = escapeHtml(appConfig.supportEmail);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>You’re offline — ${appName}</title>
<script>${themeScript}</script>
<style>
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.148 0.004 228.8);
  --primary: oklch(0.218 0.008 223.9);
  --primary-foreground: oklch(0.987 0.002 197.1);
  --muted-foreground: oklch(0.56 0.021 213.5);
  --ring: oklch(0.723 0.014 214.4);
}
.dark {
  --background: oklch(0.148 0.004 228.8);
  --foreground: oklch(0.987 0.002 197.1);
  --primary: oklch(0.925 0.005 214.3);
  --primary-foreground: oklch(0.218 0.008 223.9);
  --muted-foreground: oklch(0.723 0.014 214.4);
  --ring: oklch(0.56 0.021 213.5);
}
body { margin: 0; background: var(--background); color: var(--foreground); font-family: system-ui, sans-serif; line-height: 1.5; }
main { display: flex; flex-direction: column; align-items: center; gap: 32px; max-width: 36rem; margin: 0 auto; padding: 80px 16px; text-align: center; }
.text { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.status { margin: 0; color: var(--muted-foreground); font-size: 12px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; }
h1 { margin: 0; font-size: 36px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.15; text-wrap: balance; }
.muted { margin: 0; color: var(--muted-foreground); font-size: 14px; text-wrap: pretty; }
.muted a { color: var(--foreground); font-weight: 500; text-underline-offset: 4px; }
button { height: 36px; padding: 0 12px; border: 1px solid var(--primary); background: var(--primary); color: var(--primary-foreground); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
@media (pointer: coarse) { button { height: 48px; } }
button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<img src="${await brandIconSrc()}" alt="" width="72" height="72">
<div class="text">
<p class="status">You’re offline</p>
<h1>${appName} needs a connection.</h1>
<p class="muted">Check your Wi-Fi or mobile data. This page reloads when you’re back online.</p>
</div>
<button type="button" id="retry">Try again</button>
<p class="muted">Need a hand? Email <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
</main>
<script>
document.getElementById("retry").addEventListener("click", () => location.reload());
addEventListener("online", () => location.reload());
</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
