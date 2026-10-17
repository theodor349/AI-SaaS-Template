import { env } from "../_generated/server";
import { v } from "convex/values";

export const clerkProfile = v.object({
  clerkId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  updatedAt: v.number(),
});

export class InvalidClerkPayload extends Error {}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidClerkPayload("Expected an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidClerkPayload("Missing required string");
  }
  return value;
}

export function timestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidClerkPayload("Invalid timestamp");
  }
  return value;
}

function optionalName(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  return requiredString(value);
}

// Both Backend API snapshots and signed webhook profiles use this validation.
export function parseClerkProfile(value: unknown) {
  const data = object(value);
  const primaryId = requiredString(data.primary_email_address_id);
  if (!Array.isArray(data.email_addresses)) throw new InvalidClerkPayload("Missing email list");
  const emails = data.email_addresses.map(object);
  const primary = emails.find((email) => email.id === primaryId);
  if (!primary) throw new InvalidClerkPayload("Missing primary email");
  const email = requiredString(primary.email_address);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvalidClerkPayload("Invalid email");
  return {
    clerkId: requiredString(data.id),
    email,
    firstName: optionalName(data.first_name),
    lastName: optionalName(data.last_name),
    updatedAt: timestamp(data.updated_at),
  };
}

export function parseClerkEvent(value: unknown) {
  const event = object(value);
  const type = requiredString(event.type);
  const eventAt = timestamp(event.timestamp);
  if (type === "user.created" || type === "user.updated") {
    return { kind: "profile" as const, type, eventAt, profile: parseClerkProfile(event.data) };
  }
  if (type === "user.deleted") {
    const data = object(event.data);
    if (data.deleted !== true) throw new InvalidClerkPayload("Missing deletion marker");
    return { kind: "deletion" as const, type, eventAt, clerkId: requiredString(data.id) };
  }
  return { kind: "ignored" as const, type, eventAt };
}

// The configured issuer as Clerk writes it in JWTs. Deployment settings may add
// a trailing slash that the token's issuer and tokenIdentifier never contain.
export function clerkIssuer() {
  return env.CLERK_JWT_ISSUER_DOMAIN.replace(/\/+$/, "");
}

export function clerkTokenIdentifier(clerkId: string) {
  // Matches Convex's issuer|subject identity key, including the configured issuer.
  return `${clerkIssuer()}|${clerkId}`;
}
