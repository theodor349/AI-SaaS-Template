# Security policy

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting. Open the repository's [Security tab](https://github.com/theodor349/AI-SaaS-Template/security) and choose **Report a vulnerability**, or go straight to the [report form](https://github.com/theodor349/AI-SaaS-Template/security/advisories/new). The report stays private between you and the maintainers.

Do not open a public issue or pull request for a vulnerability, and do not describe one in a comment.

A useful report says which file or flow is affected, how to reproduce the problem, and what an attacker gains from it.

## Scope

In scope is the code in this repository: the Next.js app, the Convex functions, the scripts, and the GitHub Actions workflows.

Out of scope:

- Apps built from this template. Their owners run them and are responsible for their security. Report a problem in such an app to its owner. If the cause is in the template's code, report it here as well.
- Clerk, Convex, Polar, Vercel, Sentry, Resend, and the other services the template connects to. Report those to the provider.
- Vulnerabilities in npm dependencies that the template's code does not make reachable. Report those to the package's maintainers.

## Where fixes land

Fixes go to the `main` branch. The template has no versioned releases, so an app built from it gets a fix by merging the template's `main`.
