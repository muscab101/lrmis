"use client";

import type { CampaignSummary } from "@/lib/server/messages";
import { CampaignButtons, CampaignStateBadge, useCampaignLabel } from "./history";

/** The campaign's name and state, with retry / stop beside it. */
export function CampaignDetailHeader({ campaign, can }: { campaign: CampaignSummary; can: { retry: boolean; cancel: boolean } }) {
  const label = useCampaignLabel();
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span>{label(campaign)}</span>
      <CampaignStateBadge state={campaign.state} />
      <span className="text-base font-normal">
        <CampaignButtons campaign={campaign} can={can} />
      </span>
    </span>
  );
}
