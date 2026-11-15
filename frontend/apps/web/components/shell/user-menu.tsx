"use client";

import { Avatar } from "@dhulka/ui/form-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dhulka/ui/dropdown-menu";
import { Camera, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { ProfilePhotoDialog } from "@/components/shell/profile-photo-dialog";
import { useRouter } from "@/i18n/navigation";

/** The account menu. Citizens sign in with an SMS code, so they have no password or two-factor settings. */
export function UserMenu({ name, email, photo = null, citizen = false }: { name: string; email: string | null; photo?: string | null; citizen?: boolean }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photoOpen, setPhotoOpen] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-md focus-visible:outline-2 focus-visible:outline-ring" aria-label={t("account")}>
        <Avatar name={name || email || "?"} src={photo} className="rounded-full" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-foreground">
          <div className="truncate text-sm font-semibold">{name}</div>
          {email && email !== name && <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setPhotoOpen(true)}>
          <Camera />
          {t("profilePhoto")}
        </DropdownMenuItem>
        {!citizen && (
          <>
            <DropdownMenuItem onSelect={() => router.push("/change-password")}>
              <KeyRound />
              {t("changePassword")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/mfa")}>
              <ShieldCheck />
              {t("twoFactor")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          disabled={pending}
          onSelect={() =>
            start(async () => {
              await signOutAction();
              router.replace(citizen ? "/citizen/login" : "/login");
              router.refresh();
            })
          }
        >
          <LogOut />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ProfilePhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} name={name || email || "?"} photo={photo} />
    </DropdownMenu>
  );
}
