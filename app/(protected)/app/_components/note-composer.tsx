"use client";

import { useState, type SubmitEvent } from "react";
import { api } from "@/convex/_generated/api";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation } from "@/lib/convex";
import { emptyDraft, noteError, NoteFields, type NoteError } from "./note-form";

export function NoteComposer() {
  const create = useMutation(api.notes.notes.create);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<NoteError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      await create(draft);
      setDraft(emptyDraft);
    } catch (failure) {
      setError(noteError(failure));
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSaving) void save();
  }

  return (
    <Card aria-label="New note">
      <CardHeader>
        <CardTitle>New note</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <NoteFields id="new-note" draft={draft} error={error} onChange={setDraft} />
          <div>
            <Button type="submit" disabled={isSaving} aria-busy={isSaving} aria-live="polite">
              <ButtonLabel loading={isSaving} loadingText="Adding...">Add note</ButtonLabel>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
