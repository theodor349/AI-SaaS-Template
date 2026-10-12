"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogIn, Sparkles, UserPlus } from "lucide-react";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ProfileMenu } from "./profile-menu";
import styles from "./site-navigation.module.css";

const pages = [
  { href: AUTHENTICATED_DESTINATION, label: "Dashboard", icon: LayoutDashboard },
];

export function SiteNavigation() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading, isRefreshing } = useConvexAuth();
  const ready = isAuthenticated && !isLoading && !isRefreshing;

  return (
    <header className={styles.bar}>
      <nav aria-label="Main navigation" className={styles.navigation}>
        <div className={styles.destinations}>
          <Link href="/" className={styles.brand}>
            <span className={styles.logo}><Sparkles aria-hidden="true" size={20} /></span>
            <span>AI SaaS Template</span>
          </Link>
          {isSignedIn && pages.map(({ href, label, icon: Icon }) => {
            if (label === "Dashboard" && !ready) {
              return (
                <span key={href} aria-hidden="true" className={cn(styles.pageLink, styles.disabledLink)}>
                  <Icon size={20} /><span className={styles.pageLabel}>{label}</span>
                </span>
              );
            }
            const active = pathname === href.split(/[?#]/)[0];
            return (
              <Link key={href} href={href} prefetch={false} aria-label={label} title={label}
                aria-current={active ? "page" : undefined} className={styles.pageLink}>
                <Icon aria-hidden="true" size={20} />
                <span className={styles.pageLabel}>{label}</span>
              </Link>
            );
          })}
        </div>
        <div className={styles.controls}>
          {!isLoaded && <span className={styles.avatarPending} role="status" aria-label="Loading navigation" />}
          {isLoaded && !isSignedIn && <GuestControls />}
          {isLoaded && isSignedIn && <ProfileMenu />}
        </div>
      </nav>
    </header>
  );
}

function GuestControls() {
  return (
    <>
      <SignInButton mode="modal">
        <button className={styles.pageLink} aria-label="Sign in" title="Sign in">
          <LogIn aria-hidden="true" size={20} /><span className={styles.pageLabel}>Sign in</span>
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button className={styles.pageLink} aria-label="Sign up" title="Sign up">
          <UserPlus aria-hidden="true" size={20} /><span className={styles.pageLabel}>Sign up</span>
        </button>
      </SignUpButton>
    </>
  );
}
