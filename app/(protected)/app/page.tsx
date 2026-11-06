import type { Metadata } from "next";
import { NoteComposer } from "./_components/note-composer";
import { NoteList } from "./_components/note-list";
import { Welcome } from "./_components/welcome";

export const metadata: Metadata = { title: "Notes" };

export default function ApplicationPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Notes</h1>
        <Welcome />
      </header>
      <NoteComposer />
      <NoteList />
    </div>
  );
}
