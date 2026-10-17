/// <reference types="vite/client" />
// The modules convex-test loads. Globbed from the convex root so a test in any
// folder registers every function; the multi-dot name keeps Convex from deploying it.
export const modules = import.meta.glob("./**/*.ts");
