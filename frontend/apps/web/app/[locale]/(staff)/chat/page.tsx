import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChatApp } from "@/components/chat/chat-app";
import { requireStaff } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("chat");
  return { title: t("title") };
}

/** Staff chat: one to one and groups, with images and videos. Every active staff member has it. */
export default async function ChatPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ c?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const { c } = await searchParams;
  return <ChatApp me={viewer.user.id} initial={c && /^[0-9a-f-]{36}$/i.test(c) ? c : null} />;
}
