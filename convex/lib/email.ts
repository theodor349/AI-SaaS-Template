import { Resend } from "@convex-dev/resend";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import type { MutationCtx } from "./functions";

type Email = { to: string; subject: string; text: string; replyTo?: string[]; idempotencyKey: string };

// Queues a transactional email in the Resend component, which retries delivery
// durably. Returns null when the deployment has no email configured, as in
// local worktrees; callers decide whether that needs operator attention.
export async function sendEmail(ctx: MutationCtx, email: Email) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return null;
  }
  const resend = new Resend(components.resend, { apiKey: env.RESEND_API_KEY, testMode: false });
  return resend.sendEmail(ctx, { from: env.EMAIL_FROM, ...email });
}
