import { appError } from "../lib/errors";

// Shared by the server's checks and the note form's maxLength, so the browser
// stops input at the same length the server accepts.
export const noteLimits = { title: 200, body: 10_000 };

// Trimmed note fields. Throws a typed error the form shows next to the field.
export function noteFields(title: string, body: string) {
  const fields = { title: title.trim(), body: body.trim() };
  if (!fields.title || fields.title.length > noteLimits.title) throw appError("INVALID_NOTE_TITLE");
  if (fields.body.length > noteLimits.body) throw appError("INVALID_NOTE_BODY");
  return fields;
}
