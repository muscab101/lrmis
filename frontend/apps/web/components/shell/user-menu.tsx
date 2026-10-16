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
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { useRouter } from "@/i18n/navigation";

export function UserMenu({ name, email }: { name: string; email: string | null }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-md focus-visible:outline-2 focus-visible:outline-ring" aria-label={t("account")}>
        <Avatar name={name || email || "?"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-foreground">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/change-password")}>
          <KeyRound />
          {t("changePassword")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/mfa")}>
          <ShieldCheck />
          {t("twoFactor")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          disabled={pending}
          onSelect={() =>
            start(async () => {
              await signOutAction();
              router.replace("/login");
              router.refresh();
            })
          }
        >
          <LogOut />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
