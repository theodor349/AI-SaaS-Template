# Security headers and the Content Security Policy

[next.config.js](../../next.config.js) sends the fixed headers with every response, static files included: `nosniff`, the referrer policy, a `Permissions-Policy` that turns off unused features, `X-Frame-Options: DENY`, and HSTS in production builds. The Content Security Policy is built by [csp.ts](../../lib/security/csp.ts) and set by [proxy.ts](../../proxy.ts) on every page and route. The proxy is where the policy can read the [consent registry](../../lib/consent/services.ts), and setting headers there leaves static pages static.

## An allowlist, not nonces

A strict policy gives each script a per-request nonce. A nonce must differ on every response, so every page would have to render dynamically, and so would pages that are prerendered today. The policy instead lists the origins scripts, connections, frames, and images may come from, and allows inline scripts with `'unsafe-inline'`, because Next's hydration payloads and the theme script are inline and a static page can't carry a nonce. Adding a hash or nonce later makes browsers ignore `'unsafe-inline'`, so that change has to cover every inline script at once.

What it protects against: other sites framing the app (clickjacking), script files loaded from hosts outside the list, injected `<base>` and `<object>` tags, forms posting off-site, and data sent with `fetch` or WebSockets to hosts outside the list. What it doesn't: an injection that runs as inline script or an inline event handler, which `'unsafe-inline'` allows. Such a script can still read the page and send data through allowed hosts or navigation. Escaping output, as React does, remains the defense against XSS.

## Adding a service

A third-party service the browser talks to needs its origins in the policy, or it fails with a console error and, in production, a Sentry report. A service in the consent registry declares them in its `origins` field. The origins are allowed on every page whether or not the visitor granted the category; consent decides whether the code loads, not where it may connect. Infrastructure that isn't a consent service, like Clerk and Convex, is listed in csp.ts. Polar's checkout and customer portal are full-page navigations, which the policy doesn't restrict.

## Rolling out a change

`CSP_REPORT_ONLY=1` sends the policy as `Content-Security-Policy-Report-Only`: browsers report violations without blocking anything. With a Sentry DSN, browsers send reports to Sentry's security endpoint in both modes. Reports go straight from the browser to Sentry without analytics consent. They are a security function, and they carry the page and blocked URLs, the user agent, and the visitor's IP address.

`next dev` adds `'unsafe-eval'`, which React needs for its development tooling, and the app's own WebSocket origin for hot reload. Bootstrap's local DSN points reports at a same-origin path that answers 404, so worktrees never report to a real Sentry project.
