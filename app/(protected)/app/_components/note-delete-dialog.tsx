"use client";

import { AlertCircleIcon, Trash2Icon } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, ButtonLabel } from "@/components/ui/button";
import { useMutation } from "@/lib/convex";

export function NoteDeleteDialog({ note }: { note: Doc<"notes"> }) {
  const remove = useMutation(api.notes.notes.remove);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (isDeleting) return;
    setFailed(false);
    setOpen(next);
  }

  // A deleted note's card unmounts with this dialog, so success needs no
  // further feedback. A failure keeps the dialog open to retry.
  async function confirm() {
    setIsDeleting(true);
    setFailed(false);
    try {
      await remove({ noteId: note._id });
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!isDeleting) void confirm();
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${note.title}`}>
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note?</AlertDialogTitle>
          <AlertDialogDescription>“{note.title}” will be permanently deleted.</AlertDialogDescription>
        </AlertDialogHeader>
        {failed && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Couldn’t delete the note</AlertTitle>
            <AlertDescription>Try again in a moment.</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Keep note</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDeleting}
            aria-busy={isDeleting}
            aria-live="polite"
            onClick={handleConfirm}
          >
            <ButtonLabel loading={isDeleting} loadingText="Deleting...">Delete note</ButtonLabel>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
