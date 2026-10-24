import { expect, test } from "vitest";
import { taxDescription } from "./tax";

test("only tax-inclusive prices say tax is included", () => {
  expect(taxDescription("inclusive")).toBe("Tax included");
  for (const behavior of ["exclusive", "location"]) {
    expect(taxDescription(behavior)).toMatch(/at checkout/);
    expect(taxDescription(behavior)).not.toMatch(/included/);
  }
});
