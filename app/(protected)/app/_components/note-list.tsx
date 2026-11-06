"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlag } from "@/lib/feature-flags";
import { NoteCard } from "./note-card";

const pageSize = 20;

export function NoteList() {
  const { results, status, loadMore } = usePaginatedQuery(api.notes.notes.list, {}, { initialNumItems: pageSize });
  // Cards show a pin button while notePinning is on. Waiting for the flag
  // keeps their actions from shifting when it arrives.
  const pinning = useFlag("notePinning");

  if (status === "LoadingFirstPage" || pinning === undefined) return <NoteListSkeleton />;
  if (results.length === 0) return <EmptyNotes />;

  return (
    <section aria-label="Your notes" className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {results.map((note) => (
          <li key={note._id}>
            <NoteCard note={note} />
          </li>
        ))}
      </ul>
      {status !== "Exhausted" && (
        <div>
          <Button
            variant="outline"
            disabled={status === "LoadingMore"}
            aria-busy={status === "LoadingMore"}
            aria-live="polite"
            onClick={() => loadMore(pageSize)}
          >
            <ButtonLabel loading={status === "LoadingMore"} loadingText="Loading...">Load more notes</ButtonLabel>
          </Button>
        </div>
      )}
    </section>
  );
}

function EmptyNotes() {
  return (
    <Card aria-label="Your notes">
      <CardHeader>
        <CardTitle>No notes yet</CardTitle>
        <CardDescription>Notes you add appear here, most recently edited first.</CardDescription>
      </CardHeader>
    </Card>
  );
}

// Three cards shaped like a note with a one-line title and a two-line body.
function NoteListSkeleton() {
  return (
    <section aria-label="Your notes" aria-busy="true" className="flex flex-col gap-4">
      <p role="status" className="sr-only">Loading notes…</p>
      {[0, 1, 2].map((key) => (
        <Card key={key} aria-hidden="true">
          <CardHeader>
            <div className="w-1/3">
              <Skeleton size="line" animation="pulse" />
            </div>
            <div className="w-1/4">
              <Skeleton size="line" animation="pulse" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1">
              <Skeleton size="line" animation="pulse" />
              <div className="w-2/3">
                <Skeleton size="line" animation="pulse" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
