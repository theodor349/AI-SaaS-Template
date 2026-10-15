// E2E-only fake Sentry ingest for the local DSN next.config.js sets up. It keeps the
// latest envelopes browser and server Sentry send, and GET returns them so tests can
// inspect server events. A 404 everywhere else.
const envelopes: string[] = [];

export async function POST(request: Request) {
  if (process.env.E2E_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  // The server transport gzips large envelopes.
  const body = request.headers.get("content-encoding") === "gzip"
    ? request.body?.pipeThrough(new DecompressionStream("gzip"))
    : request.body;
  envelopes.push(await new Response(body).text());
  envelopes.splice(0, envelopes.length - 200);
  return Response.json({});
}

export function GET() {
  if (process.env.E2E_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  return Response.json(envelopes);
}
