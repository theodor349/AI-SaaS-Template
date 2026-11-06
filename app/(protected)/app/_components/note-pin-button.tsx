"use client";

import { PinIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useMutation } from "@/lib/convex";
import { useFlag } from "@/lib/feature-flags";

// Behind the notePinning flag, which the template ships turned off. The
// backend's setPinned checks the flag too.
export function NotePinButton({ note }: { note: Doc<"notes"> }) {
  const pinning = useFlag("notePinning");
  const setPinned = useMutation(api.notes.notes.setPinned);
  const [isSaving, setIsSaving] = useState(false);

  if (!pinning) return null;

  async function toggle() {
    setIsSaving(true);
    toast.dismiss(`note-pin-${note._id}`);
    try {
      await setPinned({ noteId: note._id, pinned: !note.pinned });
    } catch {
      toast.error(note.pinned ? "Couldn’t unpin the note" : "Couldn’t pin the note", {
        description: "Try again in a moment.",
        id: `note-pin-${note._id}`,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Button
      variant={note.pinned ? "secondary" : "ghost"}
      size="icon"
      aria-label={`Pin ${note.title}`}
      aria-pressed={note.pinned}
      disabled={isSaving}
      aria-busy={isSaving}
      onClick={() => void toggle()}
    >
      <PinIcon />
    </Button>
  );
}
