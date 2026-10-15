import { Button } from "@/components/ui/button";

async function crash() {
  "use server";
  // Server Functions are reachable even where the page is a 404.
  if (process.env.E2E_TEST_ROUTES !== "1") return;
  throw new Error("E2E Server Function crash");
}

// A form whose Server Function throws, for server error reporting tests.
export function ServerFunctionCrash() {
  return (
    <form action={crash}>
      <Button type="submit">Run a crashing Server Function</Button>
    </form>
  );
}
