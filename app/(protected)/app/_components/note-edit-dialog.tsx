"use client";

import { PencilIcon } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button, ButtonLabel } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation } from "@/lib/convex";
import { noteError, NoteFields, type NoteDraft, type NoteError } from "./note-form";

export function NoteEditDialog({ note }: { note: Doc<"notes"> }) {
  const update = useMutation(api.notes.notes.update);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>({ title: note.title, body: note.body });
  const [error, setError] = useState<NoteError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Each opening starts from the note's latest saved text. A pending save
  // keeps the dialog open so its result has somewhere to show.
  function handleOpenChange(next: boolean) {
    if (isSaving) return;
    if (next) {
      setDraft({ title: note.title, body: note.body });
      setError(null);
    }
    setOpen(next);
  }

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      await update({ noteId: note._id, ...draft });
      setOpen(false);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Edit ${note.title}`}>
          <PencilIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <NoteFields id={`edit-${note._id}`} draft={draft} error={error} onChange={setDraft} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSaving}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving} aria-busy={isSaving} aria-live="polite">
              <ButtonLabel loading={isSaving} loadingText="Saving...">Save note</ButtonLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
