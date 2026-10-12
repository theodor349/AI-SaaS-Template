import { FileText } from "lucide-react";

export function PolicyTemplate({ title, description }: { title: string; description: string }) {
  return (
    <article className="flex flex-col gap-6">
      <div className="flex items-center gap-3 text-muted-foreground">
        <FileText aria-hidden="true" size={20} />
        <span className="text-sm">Policy template</span>
      </div>
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="rounded-lg border bg-muted p-6">
        <h2 className="font-semibold">This page is a placeholder</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      <p className="text-sm text-muted-foreground">The application owner has not published this policy yet.</p>
    </article>
  );
}
