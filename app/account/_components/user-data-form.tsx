"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { CircleQuestionMark } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSkeleton } from "./account-skeleton";

export function UserDataForm() {
  return (
    <AuthBoundary pending={<UserDataFormSkeleton />}>
      <UserDataFormContent />
    </AuthBoundary>
  );
}

function UserDataFormSkeleton() {
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
          <div className="flex flex-col gap-2">
            <Label>Email</Label>
            <div className="flex flex-col">
              <Skeleton size="input" aria-hidden="true" />
              <EmailHelp />
            </div>
          </div>
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

function EmailHelp() {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <p id="account-email-description">
        * Your email is managed through your sign-in provider.
      </p>
    </div>
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

    if (isSaving) {
      return;
    }

    void submitProfile();
  }

  async function submitProfile() {
    const submitted = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
    };

    setIsSaving(true);
    setError("");

    try {
      await saveProfile(submitted);
      setDraft(submitted);
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-email">Email</Label>
            <div className="flex flex-col">
              <Input
                id="account-email"
                type="email"
                value={user.email}
                disabled
                aria-describedby="account-email-description"
              />
              <EmailHelp />
            </div>
          </div>
          <div>
            <Button disabled={isSaving} type="submit" aria-live="polite">
              {isSaving ? "Saving..." : "Save profile"}
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
