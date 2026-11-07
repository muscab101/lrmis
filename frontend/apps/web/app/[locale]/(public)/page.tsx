import { BrandMark } from "@dhulka/ui/brand";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowField } from "@/components/landing/arrow-field";
import { LandingHeader } from "@/components/landing/landing-header";
import { FocusCards, ScrollWords } from "@/components/landing/scroll-sections";
import { StepsStory } from "@/components/landing/steps-story";
import { CountUp, Reveal, ScrollProgress } from "@/components/landing/reveal";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

const FEATURES = ["register", "pay", "verify"] as const;
const AUDIENCES = ["owner", "buyer", "bank", "staff"] as const;
const STEPS = [
  { key: "apply", tag: "you" },
  { key: "fee", tag: "office" },
  { key: "survey", tag: "field" },
  { key: "verify", tag: "office" },
  { key: "notice", tag: "public" },
  { key: "register", tag: "office" },
  { key: "certificate", tag: "you" },
] as const;

const TAG_CLASS: Record<string, string> = {
  you: "bg-[#e6f04a]/60 text-[#3d4210]",
  office: "bg-[#2a55d6]/10 text-[#1f45b8]",
  field: "bg-emerald-600/10 text-emerald-800",
  public: "bg-amber-500/15 text-amber-800",
};

/** Gradient glyphs for the three features (no image assets). */
function FeatureGlyph({ kind }: { kind: (typeof FEATURES)[number] }) {
  const id = `g-${kind}`;
  return (
    <svg viewBox="0 0 48 48" className="size-12" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9db8ff" />
          <stop offset="1" stopColor="#1f45b8" />
        </linearGradient>
      </defs>
      {kind === "register" && <path d="M8 14 24 6l16 8v20l-16 8-16-8z M24 6v36 M8 14l16 8 16-8" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinejoin="round" />}
      {kind === "pay" && <circle cx="24" cy="24" r="15" fill="none" stroke={`url(#${id})`} strokeWidth="7" />}
      {kind === "verify" && <path d="M9 25l10 10 20-22" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");
  const supabase = await createClient();
  const { data: notices } = await supabase.rpc("public_notices_active");
  const noticeCount = (notices as unknown[] | null)?.length ?? 0;

  return (
    <div className="min-h-dvh bg-white text-[#0b1a3a]">
      <LandingHeader>
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-2 px-4 sm:gap-4 sm:px-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark className="size-9" />
            <span className="hidden text-lg min-[380px]:inline">{tc("appShortName")}</span>
          </Link>
          <p className="hidden truncate text-center text-sm font-medium md:block">
            {t("barOrg")} <span className="mx-2 opacity-50">|</span> {t("barCity")}
          </p>
          <div className="flex items-center justify-end gap-1 [&_button]:text-current [&_button:hover]:bg-black/5">
            <LocaleSwitch />
            <Link href="/citizen/login" className="rounded-md bg-white px-3 py-2 text-[13px] font-medium whitespace-nowrap text-[#0b2a8f] shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white/90 group-data-[solid]/header:ring-[#0b2a8f]/20 sm:px-3.5 sm:text-sm">
              {t("citizenCta")}
            </Link>
          </div>
        </div>
      </LandingHeader>

      {/* Hero */}
      <section className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden">
        <ArrowField className="absolute inset-0 -z-10 h-full w-full" />
        <ScrollProgress distance={700} className="px-5 text-center text-white [transform:translateY(calc(var(--p)*-120px))_scale(calc(1-var(--p)*0.12))] [opacity:calc(1-var(--p)*0.85)]">
          <BrandMark title={t("barOrg")} className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-1000 ease-out motion-reduce:animate-none mx-auto mb-6 size-20 drop-shadow-[0_6px_24px_rgba(11,42,143,0.45)] sm:size-24" />
          <h1 className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-1000 ease-out motion-reduce:animate-none text-[clamp(72px,15vw,208px)] leading-[0.9] font-semibold tracking-[-0.045em] [text-shadow:0_8px_40px_rgba(11,42,143,0.35)]">
            {tc("appShortName")}
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-1000 ease-out motion-reduce:animate-none mx-auto mt-6 max-w-md text-lg [animation-delay:200ms] leading-snug font-medium text-balance sm:text-2xl">{t("heroLead")}</p>
          <div className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-1000 ease-out motion-reduce:animate-none mt-10 flex flex-wrap justify-center gap-3 [animation-delay:400ms]">
            <Link href="/citizen/login" className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#0b2a8f] shadow-lg shadow-[#0b2a8f]/20 transition-transform hover:-translate-y-0.5">
              {t("citizenCta")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
            <Link href="/login" className="inline-flex items-center rounded-md border border-[#0b2a8f]/25 bg-white/40 px-5 py-3 text-sm font-semibold text-[#0b2a8f] backdrop-blur transition-colors hover:bg-white/60">
              {t("staffCta")}
            </Link>
          </div>
        </ScrollProgress>
      </section>

      {/* What Dhulka does: the heading stays put while the features pass by, the one in the middle in focus. */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:py-32">
        <FocusCards
          heading={
            <Reveal variant="blur">
              <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">{t("whatTitle")}</h2>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#4a5468]">{t("whatBody")}</p>
            </Reveal>
          }
          items={FEATURES.map((f) => ({ key: f, title: t(`features.${f}.title`), body: t(`features.${f}.body`), glyph: <FeatureGlyph kind={f} /> }))}
        />
      </section>

      {/* Who it's for: one statement per audience, lighting up word by word as you scroll. */}
      <section className="mx-auto max-w-7xl px-5 pb-24 sm:pb-32">
        <Reveal variant="blur">
          <h2 className="mb-12 text-4xl font-semibold tracking-tight sm:text-6xl">{t("whoTitle")}</h2>
        </Reveal>
        <ScrollWords items={AUDIENCES.map((a) => ({ key: a, label: t(`audiences.${a}.label`), text: t(`audiences.${a}.text`) }))} />
      </section>

      {/* How registration works */}
      <section className="mx-auto max-w-7xl px-5 pb-24 sm:pb-32">
        <Reveal variant="blur">
          <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">{t("howTitle")}</h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#4a5468]">{t("howBody")}</p>
        </Reveal>
        <StepsStory
          steps={STEPS.map((x) => ({
            key: x.key,
            when: t(`steps.${x.key}.when`),
            title: t(`steps.${x.key}.title`),
            body: t(`steps.${x.key}.body`),
            tag: t(`tags.${x.tag}`),
            tagClass: TAG_CLASS[x.tag]!,
          }))}
        />
      </section>

      {/* Band: arrives as a rounded card and opens out to the full width. */}
      <ScrollProgress from={1} to={1}>
      <section className="relative isolate overflow-hidden [margin-inline:calc((1-var(--p))*2.5rem)] [border-radius:calc((1-var(--p))*2rem)] max-sm:[margin-inline:calc((1-var(--p))*1rem)]">
        <ArrowField flip className="absolute inset-0 -z-10 h-full w-full" />
        <Reveal className="mx-auto grid max-w-7xl gap-10 px-5 pt-32 pb-20 text-white sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-6xl font-semibold tracking-tight tabular-nums sm:text-8xl">
              <CountUp value={noticeCount} />
            </p>
            <p className="mt-2 max-w-md text-lg font-medium">{t("bandNotices", { count: noticeCount })}</p>
            <Link href="/notices" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline">
              {t("bandNoticesCta")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/citizen/login" className="rounded-md bg-[#e6f04a] px-5 py-3 text-sm font-semibold text-[#1d2208] hover:bg-[#dbe63a]">
              {t("citizenCta")}
            </Link>
          </div>
        </Reveal>
        <footer className="border-t border-white/15">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-5 py-6 text-xs text-white/70">
            <span>
              © {new Date().getFullYear()} {tc("orgName")}
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/notices" className="hover:text-white">
                {t("footerNotices")}
              </Link>
              <Link href="/login" className="hover:text-white">
                {t("staffCta")}
              </Link>
              <span>Muqdisho · Mogadishu</span>
            </span>
          </div>
        </footer>
      </section>
      </ScrollProgress>
    </div>
  );
}
