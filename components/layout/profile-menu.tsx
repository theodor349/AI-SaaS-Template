"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { useRef, useState } from "react";
import Link from "next/link";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Cookie, CreditCard, Download, FileText, LogOut, Settings, Shield, SlidersHorizontal, UserRound } from "lucide-react";
import { DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CookiePreferences } from "@/components/consent/cookie-preferences";
import { useInstallPrompt } from "@/components/pwa/use-install-prompt";
import { api } from "@/convex/_generated/api";
import styles from "./site-navigation.module.css";

const accountPages = [
  { href: "/account", label: "Account", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
];
const legalPages = [
  { href: "/privacy", label: "Privacy Policy", icon: Shield },
  { href: "/terms", label: "Terms of Service", icon: FileText },
  { href: "/cookies", label: "Cookie Policy", icon: Cookie },
];

export function ProfileMenu() {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const current = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const { signOut } = useClerk();
  const { canInstall, install } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayName = current?.status === "ready" ? current.user.displayName : null;
  const name = displayName || "Your account";

  async function handleSignOut() {
    setSigningOut(true);
    setError(undefined);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      setError("Couldn’t sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button ref={triggerRef} className={styles.profileButton} aria-label="Open profile menu">
            <Avatar size="lg">
              <AvatarImage src={user?.imageUrl} alt="" />
              <AvatarFallback><UserRound aria-hidden="true" size={20} /></AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          {/* This feature owns its menu surface; shared UI primitives keep their preset. */}
          <MenuPrimitive.Content align="end" sideOffset={12} collisionPadding={16} className={styles.menu}
            onCloseAutoFocus={(event) => { if (preferencesOpen) event.preventDefault(); }}>
            <MenuPrimitive.Label className={styles.identity}>
              <span className={styles.name}>{name}</span>
              <span className={styles.email}>{user?.primaryEmailAddress?.emailAddress}</span>
            </MenuPrimitive.Label>
            <MenuPrimitive.Separator className={styles.separator} />
            <MenuPrimitive.Group className={styles.menuGroup} aria-label="Account pages">
              {accountPages.map(({ href, label, icon: Icon }) => (
                <MenuPrimitive.Item key={href} asChild>
                  <Link href={href} prefetch={false} className={styles.menuItem} aria-label={label}>
                    <Icon aria-hidden="true" size={16} /><span className={styles.pageLabel}>{label}</span>
                  </Link>
                </MenuPrimitive.Item>
              ))}
              {canInstall && (
                <MenuPrimitive.Item className={styles.menuItem} aria-label="Install app"
                  onSelect={() => void install()}>
                  <Download aria-hidden="true" size={16} /><span className={styles.pageLabel}>Install app</span>
                </MenuPrimitive.Item>
              )}
            </MenuPrimitive.Group>
            <MenuPrimitive.Separator className={styles.separator} />
            <MenuPrimitive.Group className={styles.menuGroup}>
              {legalPages.map(({ href, label, icon: Icon }) => (
                <MenuPrimitive.Item key={href} asChild>
                  <Link href={href} className={styles.menuItem} aria-label={label}>
                    <Icon aria-hidden="true" size={16} /><span className={styles.pageLabel}>{label}</span>
                  </Link>
                </MenuPrimitive.Item>
              ))}
              <MenuPrimitive.Item className={styles.menuItem} aria-label="Cookie Preferences"
                onSelect={() => setPreferencesOpen(true)}>
                <SlidersHorizontal aria-hidden="true" size={16} /><span className={styles.pageLabel}>Cookie Preferences</span>
              </MenuPrimitive.Item>
            </MenuPrimitive.Group>
            <MenuPrimitive.Separator className={styles.separator} />
            <MenuPrimitive.Item className={styles.signOut} disabled={signingOut} aria-busy={signingOut} aria-label="Sign out"
              onSelect={(event) => { event.preventDefault(); void handleSignOut(); }}>
              <LogOut aria-hidden="true" size={16} />
              <span className={styles.pageLabel}>{signingOut ? "Signing out…" : "Sign out"}</span>
            </MenuPrimitive.Item>
            {error && <p role="alert" className={styles.error}>{error}</p>}
          </MenuPrimitive.Content>
        </DropdownMenuPortal>
      </DropdownMenu>
      <CookiePreferences open={preferencesOpen} onOpenChange={setPreferencesOpen}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }} />
    </>
  );
}
