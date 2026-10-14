import type { Metadata } from "next";
import { appConfig } from "@/app.config";
import { MisplacedSquare } from "./_components/misplaced-square";
import { StatusMessage } from "./_components/status-message";
import { HomeLink } from "./_components/home-link";

export const metadata: Metadata = { title: `Page not found — ${appConfig.appName}` };

export default function NotFound() {
  return (
    <StatusMessage
      illustration={<MisplacedSquare variant="missing" />}
      status="404 · Page not found"
      heading="We build just enough. This page wasn’t part of it."
      actions={<HomeLink />}
    >
      The link may be out of date, or the address may have a typo.
    </StatusMessage>
  );
}
