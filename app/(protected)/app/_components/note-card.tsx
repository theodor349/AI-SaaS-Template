"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoteDeleteDialog } from "./note-delete-dialog";
import { NoteEditDialog } from "./note-edit-dialog";
import { NotePinButton } from "./note-pin-button";

const editedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function NoteCard({ note }: { note: Doc<"notes"> }) {
  return (
    <Card aria-label={note.title}>
      <CardHeader>
        <CardTitle>
          <span className="break-words">{note.title}</span>
        </CardTitle>
        <CardDescription>Edited {editedAt.format(note.updatedAt)}</CardDescription>
        <CardAction>
          <div className="flex gap-1">
            <NotePinButton note={note} />
            <NoteEditDialog note={note} />
            <NoteDeleteDialog note={note} />
          </div>
        </CardAction>
      </CardHeader>
      {note.body && (
        <CardContent>
          <p className="line-clamp-6 whitespace-pre-wrap break-words">{note.body}</p>
        </CardContent>
      )}
    </Card>
  );
}
