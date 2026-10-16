"use client";

import { Input } from "@dhulka/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useState, type ComponentProps } from "react";

export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  const t = useTranslations("auth");
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className="pe-10" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={visible ? t("hidePassword") : t("showPassword")}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
