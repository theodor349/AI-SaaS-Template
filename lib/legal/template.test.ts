import { expect, test } from "vitest";
import { markdownTable, parseFrontMatter, renderTemplate } from "./template";

const values = {
  variables: { APP_NAME: "Example" },
  blocks: { list: "- one\n- two\n" },
  flags: { ON: true, OFF: false },
};

test("variables, blocks, and optional sections are filled in", () => {
  const body = "Use {{APP_NAME}}.\n\n{{block:list}}\n\n{{#if ON}}\nKept.\n{{/if}}\n{{#if OFF}}\nDropped.\n{{/if}}\nEnd.";
  expect(renderTemplate(body, values)).toBe("Use Example.\n\n- one\n- two\n\nKept.\nEnd.");
});

test.each([
  ["{{COMPANY_NAME}}", "Unknown variable in legal document: COMPANY_NAME"],
  ["{{block:missing}}", "Unknown block in legal document: missing"],
  ["{{#if MISSING}}\nText\n{{/if}}", "Unknown flag in legal document: MISSING"],
  ["{{#if ON}}\nText", "Unknown variable in legal document: #if ON"],
  ["{{toString}}", "Unknown variable in legal document: toString"],
])("%s fails instead of rendering literally", (body, message) => {
  expect(() => renderTemplate(body, values)).toThrow(message);
});

test("front matter is read from the top of the file", () => {
  expect(parseFrontMatter("---\r\ntitle: Terms: short\r\nversion: 2\r\n---\r\nBody\r\n"))
    .toEqual({ data: { title: "Terms: short", version: "2" }, body: "Body\n" });
  expect(() => parseFrontMatter("Body")).toThrow("missing its front matter");
});

test("table cells cannot break the table", () => {
  expect(markdownTable(["A", "B"], [["x | y", "two\nlines"]])).toBe("| A | B |\n| --- | --- |\n| x \\| y | two lines |");
});
