/// <reference types="vite/client" />
// The modules convex-test loads. Globbed from the convex root so a test in any
// folder registers every function; the multi-dot name keeps Convex from deploying it.
export const modules = import.meta.glob("./**/*.ts");

// The Vercel build runs these tests with production's variables, and a paused app's
// MAINTENANCE_MODE would refuse every public mutation. Tests that need it stub it.
delete process.env.MAINTENANCE_MODE;
