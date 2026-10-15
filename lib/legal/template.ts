// Legal documents are Markdown with front matter and three kinds of placeholder,
// all resolved before rendering:
//
//   {{APP_NAME}}                a variable
//   {{block:subprocessors}}     generated Markdown, written on its own line
//   {{#if ANALYTICS}}…{{/if}}   a section kept only when the flag is on
//
// An unknown name throws, so a typo fails the build instead of rendering literally.
export type TemplateValues = {
  variables: Record<string, string>;
  blocks: Record<string, string>;
  flags: Record<string, boolean>;
};

const frontMatterPattern = /^---\n([\s\S]*?)\n---\n/;
const sectionPattern = /\{\{#if ([^}]*)\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g;
const placeholderPattern = /\{\{([^}]*)\}\}/g;

// Reads flat `key: value` front matter; values are plain strings.
export function parseFrontMatter(source: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  const match = frontMatterPattern.exec(normalized);
  if (!match) throw new Error("Legal document is missing its front matter");
  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`Invalid front matter line: ${line}`);
    data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { data, body: normalized.slice(match[0].length) };
}

function lookup<T>(values: Record<string, T>, kind: string, name: string) {
  if (!Object.hasOwn(values, name)) throw new Error(`Unknown ${kind} in legal document: ${name}`);
  return values[name];
}

export function renderTemplate(body: string, { variables, blocks, flags }: TemplateValues) {
  // Sections do not nest; a nested or unmatched marker is left for the
  // placeholder pass below, which rejects it.
  const sections = body.replace(sectionPattern, (_, name: string, content: string) =>
    lookup(flags, "flag", name) ? content : "");
  return sections.replace(placeholderPattern, (_, token: string) => {
    if (token.startsWith("block:")) return lookup(blocks, "block", token.slice("block:".length)).trimEnd();
    return lookup(variables, "variable", token);
  });
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function markdownTable(headers: string[], rows: string[][]) {
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}
