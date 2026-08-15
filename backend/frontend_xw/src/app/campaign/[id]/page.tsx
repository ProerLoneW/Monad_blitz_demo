import { CampaignTransparencyPage } from "@/features/campaign/CampaignTransparencyPage";

/** P05 Campaign Transparency（FRONTEND_DESIGN §10.5 / §14）。 */
export default function CampaignPage({ params }: { params: { id: string } }) {
  return <CampaignTransparencyPage campaignId={params.id} />;
}
