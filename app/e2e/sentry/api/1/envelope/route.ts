// E2E-only fake Sentry ingest: accepts the envelopes browser Sentry sends to the
// local DSN next.config.js sets up, so tests can observe them. A 404 everywhere else.
export function POST() {
  if (process.env.E2E_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  return Response.json({});
}
