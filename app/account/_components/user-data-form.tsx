"use client";

import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type SubmitEvent } from "react";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSkeleton, AccountTextSkeleton } from "./account-skeleton";

export function UserDataForm() {
  return (
    <AuthBoundary pending={<UserDataFormSkeleton />}>
      <UserDataFormContent />
    </AuthBoundary>
  );
}

function UserDataFormSkeleton() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <Card aria-busy="true" aria-label="Profile">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" className="sr-only">
          Loading profile…
        </p>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>First name</Label>
            <Skeleton size="input" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Last name</Label>
            <Skeleton size="input" aria-hidden="true" />
          </div>
          <AccountTextSkeleton>Email: {email}</AccountTextSkeleton>
          <p>Your email is managed through your sign-in provider.</p>
          <div>
            <div className="w-fit">
              <AccountSkeleton>
                <Button disabled>Save profile</Button>
              </AccountSkeleton>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UserDataFormContent() {
  const current = useQuery(api.users.current);
  const saveProfile = useMutation(api.profile.save);
  const [draft, setDraft] = useState<{
    firstName: string;
    lastName: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!current || current.status === "provisioning") {
    return <AuthPending fallback={<UserDataFormSkeleton />} />;
  }

  if (current.status === "deleting") {
    return null;
  }

  const user = current.user;
  const values = draft ?? {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  };

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitProfile();
  }

  async function submitProfile() {
    const submitted = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
    };

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      await saveProfile(submitted);
      setDraft(submitted);
      setMessage("Profile saved.");
    } catch (error) {
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        error.data.code === "INVALID_NAME"
      ) {
        setError("Use names up to 100 characters without control characters.");
      } else {
        setError("We couldn’t complete the request. Try again in a moment.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card aria-label="Profile">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="first-name">First name</Label>
            <Input
              id="first-name"
              maxLength={100}
              value={values.firstName}
              onChange={(event) =>
                setDraft({ ...values, firstName: event.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="last-name">Last name</Label>
            <Input
              id="last-name"
              maxLength={100}
              value={values.lastName}
              onChange={(event) =>
                setDraft({ ...values, lastName: event.target.value })
              }
            />
          </div>
          <p>Email: {user.email}</p>
          <p>Your email is managed through your sign-in provider.</p>
          <div>
            <Button disabled={isSaving} type="submit">
              Save profile
            </Button>
          </div>
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
