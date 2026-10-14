"use client";

import { useEffect } from "react";
import { AuthRecovery } from "@/components/auth/auth-boundary";
import { reportError } from "@/lib/report-error";

export default function ApplicationError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => reportError(error), [error]);
  return <AuthRecovery />;
}
