// E2E-only route handler that always throws, for server error reporting tests; a 404
// everywhere else.
export function GET() {
  if (process.env.E2E_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  throw new Error("E2E route handler crash");
}
