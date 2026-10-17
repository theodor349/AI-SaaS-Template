"use client";

import { AlertCircleIcon } from "lucide-react";
import { hasErrorCode } from "@/convex/lib/errors";
import { noteLimits } from "@/convex/notes/validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type NoteDraft = { title: string; body: string };
// A failed save, shown next to the field it concerns or above the form.
export type NoteError = { field: "title" | "body" | null; message: string };

export const emptyDraft: NoteDraft = { title: "", body: "" };

export function noteError(error: unknown): NoteError {
  if (hasErrorCode(error, "INVALID_NOTE_TITLE")) {
    return { field: "title", message: `Give the note a title of up to ${noteLimits.title} characters.` };
  }
  if (hasErrorCode(error, "INVALID_NOTE_BODY")) {
    return { field: "body", message: `Keep the note under ${noteLimits.body.toLocaleString()} characters.` };
  }
  if (hasErrorCode(error, "NOTE_NOT_FOUND")) {
    return { field: null, message: "This note no longer exists." };
  }
  return { field: null, message: "We couldn’t save the note. Try again in a moment." };
}

// Title and body inputs shared by the composer and the edit dialog. `id`
// keeps label and error associations unique when both are on screen.
export function NoteFields({ id, draft, error, onChange }: {
  id: string;
  draft: NoteDraft;
  error: NoteError | null;
  onChange: (draft: NoteDraft) => void;
}) {
  const titleError = error?.field === "title" ? error.message : null;
  const bodyError = error?.field === "body" ? error.message : null;

  return (
    <>
      {error?.field === null && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Couldn’t save the note</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          required
          maxLength={noteLimits.title}
          value={draft.title}
          aria-invalid={titleError !== null}
          aria-describedby={titleError ? `${id}-title-error` : undefined}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
        <FieldError id={`${id}-title-error`} message={titleError} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-body`}>Note</Label>
        <Textarea
          id={`${id}-body`}
          maxLength={noteLimits.body}
          value={draft.body}
          aria-invalid={bodyError !== null}
          aria-describedby={bodyError ? `${id}-body-error` : undefined}
          onChange={(event) => onChange({ ...draft, body: event.target.value })}
        />
        <FieldError id={`${id}-body-error`} message={bodyError} />
      </div>
    </>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return <p id={id} className="text-destructive">{message}</p>;
}
