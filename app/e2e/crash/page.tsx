import { notFound } from "next/navigation";
import { throwIfE2ECrashRequested } from "@/lib/e2e-crash";

// E2E-only page for exercising app/error.tsx; a 404 everywhere else.
export default async function E2ECrashPage() {
  if (process.env.E2E_TEST_ROUTES !== "1") notFound();
  await throwIfE2ECrashRequested("page");
  return <h1 className="text-3xl font-semibold tracking-tight">The crash test page recovered</h1>;
}
