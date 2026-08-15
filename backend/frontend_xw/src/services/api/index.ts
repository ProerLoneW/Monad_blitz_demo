/**
 * Data-access layer — 组件只依赖本模块的函数签名。
 * `NEXT_PUBLIC_API_MODE=http` 时切换到真实后端（`/api/v1` 前缀），
 * 默认 mock（数据逐字来自 PROTOTYPE_PROMPTS §6 DEMO_UNIVERSE）。
 * 切换实现时组件零改动。
 */
import type {
  ApiItemResponse,
  ApiListResponse,
  AppConfig,
  Attestation,
  Campaign,
  CampaignTransparency,
  EvidenceItem,
  FeedItem,
  IncomingStreamsSummary,
  Money,
  Note,
  NoteValuePanel,
  Profile,
  Stream,
  TrackedTransaction,
  TxRequest,
} from "@proofnote/api-types";
import type { ImpactDetailExtras, ProfileStatsExtended, FeedItemView } from "@/types";
import * as mock from "@/mocks/demo-universe";

const USE_MOCK = process.env.NEXT_PUBLIC_API_MODE !== "http";
const API_BASE = "/api/v1";

const latency = (ms = 120) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) {
    const err = body as { error?: { code?: string; message?: string } };
    throw new Error(err.error?.message ?? `Request failed: ${res.status}`);
  }
  return (body as { data: T }).data;
}

function notFound(message: string): never {
  throw new Error(message);
}

// ── reads ──────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  if (USE_MOCK) {
    await latency(20);
    return mock.mockConfig;
  }
  return request<AppConfig>("/config");
}

export type FeedTab = "for-you" | "impact" | "monad";

export async function getFeed(tab: FeedTab = "for-you"): Promise<FeedItemView[]> {
  if (USE_MOCK) {
    await latency();
    if (tab === "impact") return mock.feedItems.filter((i) => i.type === "IMPACT" || i.type === "CAMPAIGN");
    // "monad" tab：生态内容——demo 里即 Alice 的 Monad 教程
    if (tab === "monad") return mock.feedItems.filter((i) => i.id === mock.NOTE_TUTORIAL);
    return mock.feedItems;
  }
  const data = await request<{ items: FeedItemView[] }>(`/feed?tab=${tab}`);
  return data.items;
}

export async function getNote(noteId: string): Promise<Note> {
  if (USE_MOCK) {
    await latency();
    return mock.notes[noteId] ?? notFound("Note not found");
  }
  return request<Note>(`/notes/${noteId}`);
}

export async function getNoteValue(noteId: string): Promise<NoteValuePanel> {
  if (USE_MOCK) {
    await latency();
    return mock.noteValuePanels[noteId] ?? notFound("Value panel not found");
  }
  return request<NoteValuePanel>(`/notes/${noteId}/value`);
}

export async function getStream(streamId: string): Promise<Stream> {
  if (USE_MOCK) {
    await latency(40);
    return mock.bobStream.streamId === streamId ? mock.bobStream : notFound("Stream not found");
  }
  return request<Stream>(`/streams/${streamId}`);
}

/** 当前用户对某 Note 的活跃 Stream（Note Detail 的 StreamControl 用）。
 *  mock：教程 Note 固定返回 Bob 的 Stream（P03 演示态），其余为 null。 */
export async function getMyStream(noteId: string): Promise<Stream | null> {
  if (USE_MOCK) {
    await latency(40);
    return noteId === mock.NOTE_TUTORIAL ? mock.bobStream : null;
  }
  // TODO(API): 后端就绪后按 supporter=me 查询；当前 SPEC 无此端点
  return null;
}

export async function getIncomingStreams(address: string): Promise<IncomingStreamsSummary> {
  if (USE_MOCK) {
    await latency();
    return mock.aliceIncoming;
  }
  return request<IncomingStreamsSummary>(`/profiles/${address}/streams/incoming`);
}

export async function getClaimable(address: string): Promise<Money> {
  if (USE_MOCK) {
    await latency();
    return mock.mon("0.123");
  }
  return request<Money>(`/profiles/${address}/claimable`);
}

export type ImpactDetail = {
  note: Note;
  extras: ImpactDetailExtras;
  evidence: EvidenceItem[];
  attestations: Attestation[];
};

export async function getImpactByNoteId(noteId: string): Promise<ImpactDetail> {
  if (USE_MOCK) {
    await latency();
    const note = mock.notes[noteId];
    if (!note?.impact) notFound("Impact note not found");
    return {
      note,
      extras: mock.riverImpactExtras,
      evidence: mock.riverEvidence,
      attestations: mock.riverAttestations,
    };
  }
  const note = await request<Note>(`/notes/${noteId}`);
  if (!note.impact) notFound("Impact note not found");
  const impact = await request<{
    claim: ImpactDetailExtras["claim"];
    evidence: EvidenceItem[];
  }>(`/impact/${note.impact.id}`);
  const attestations = await request<{ items: Attestation[] }>(
    `/impact/${note.impact.id}/attestations`,
  );
  return {
    note,
    extras: {
      claim: impact.claim,
      claimText: impact.claim.summary ?? "",
      distanceKm: "",
      wasteKg: "",
      level: note.impact.verification.level,
    },
    evidence: impact.evidence ?? [],
    attestations: attestations.items ?? [],
  };
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  if (USE_MOCK) {
    await latency();
    return campaignId === mock.CAMPAIGN_SHELTER ? mock.shelterCampaign : notFound("Campaign not found");
  }
  return request<Campaign>(`/campaigns/${campaignId}`);
}

export async function getCampaignNote(campaignId: string): Promise<Note> {
  const campaign = await getCampaign(campaignId);
  return getNote(campaign.noteId);
}

export async function getCampaignTransparency(
  campaignId: string,
): Promise<CampaignTransparency & { supporterCount: number }> {
  if (USE_MOCK) {
    await latency();
    if (campaignId !== mock.CAMPAIGN_SHELTER) notFound("Campaign not found");
    return { ...mock.shelterTransparency, supporterCount: mock.shelterSupporterCount };
  }
  const data = await request<CampaignTransparency>(`/campaigns/${campaignId}/transparency`);
  return { ...data, supporterCount: data.funding.length };
}

export async function getProfile(addressOrHandle: string): Promise<Profile & { stats: ProfileStatsExtended }> {
  if (USE_MOCK) {
    await latency();
    const key = addressOrHandle.replace(/^@/, "").toLowerCase();
    if (key === "alice" || key === mock.ADDR.alice.toLowerCase()) return mock.aliceProfile;
    if (key === "bob" || key === mock.ADDR.bob.toLowerCase()) {
      return {
        ...mock.aliceProfile,
        id: "prof_bob",
        walletAddress: mock.ADDR.bob,
        handle: "bob",
        displayName: "Bob",
        bio: "supporter & river-cleanup participant",
        stats: { ...mock.aliceProfile.stats, notes: 1, monetizedNotes: 0, collaborations: 0 },
      };
    }
    if (key === "carol" || key === mock.ADDR.carol.toLowerCase()) {
      return {
        ...mock.aliceProfile,
        id: "prof_carol",
        walletAddress: mock.ADDR.carol,
        handle: "carol",
        displayName: "Carol",
        bio: "witness of the cleanup",
        stats: { ...mock.aliceProfile.stats, notes: 0, monetizedNotes: 0, collaborations: 0 },
      };
    }
    // 无 Profile 的地址：退化为地址身份 + 全零统计（§20.2 WalletIdentity 退化）
    const zero = mock.mon("0");
    return {
      id: `prof_${key}`,
      walletAddress: addressOrHandle,
      handle: "",
      displayName: "",
      bio: "",
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      stats: {
        notes: 0,
        monetizedNotes: 0,
        creatorRevenue: zero,
        collaborations: 0,
        impactNotes: 0,
        verifiedActions: 0,
        directedToCauses: zero,
        attestationsReceived: 0,
      },
    };
  }
  return request<Profile & { stats: ProfileStatsExtended }>(`/profiles/${addressOrHandle}`);
}

export async function getProfileNotes(addressOrHandle: string): Promise<FeedItemView[]> {
  if (USE_MOCK) {
    await latency();
    const key = addressOrHandle.replace(/^@/, "").toLowerCase();
    const handleOf = (item: FeedItemView) => item.author.handle?.toLowerCase();
    if (key === "alice" || key === mock.ADDR.alice.toLowerCase()) {
      // P06 网格：教程 / River Cleanup（Impact badge）/ 摄影
      return [mock.feedItems[1], mock.feedItems[2], mock.feedItems[0], mock.feedItems[3]];
    }
    return mock.feedItems.filter((i) => handleOf(i) === key);
  }
  const data = await request<{ items: FeedItemView[] }>(`/profiles/${addressOrHandle}/notes`);
  return data.items;
}

/** P01 右栏 "On Monad now" 三行实时活动。 */
export async function getLiveActivity(): Promise<{ text: string; ago: string }[]> {
  if (USE_MOCK) {
    await latency(60);
    return mock.liveActivity;
  }
  return request<{ text: string; ago: string }[]>("/activity/live");
}

// ── writes（prepare → sendTransaction 管线；mock 下 TxRequest.mock=true）──

function mockTx(functionName: string, description: string): TxRequest {
  return {
    chainId: 10143,
    to: mock.ADDR.protocol,
    data: "0x",
    value: "0",
    functionName,
    description,
    mock: true,
  };
}

export async function prepareTip(noteId: string, amountWei: string): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx("tip", "Tip this note");
  }
  return request<TxRequest>(`/notes/${noteId}/tips/prepare`, {
    method: "POST",
    body: JSON.stringify({ amountWei }),
  });
}

export async function prepareStreamStart(
  noteId: string,
  rateWeiPerSecond: string,
  budgetWei: string,
): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx("createStream", "Start stream support");
  }
  return request<TxRequest>(`/notes/${noteId}/streams/prepare`, {
    method: "POST",
    body: JSON.stringify({ rateWeiPerSecond, budgetWei }),
  });
}

export async function prepareStreamControl(
  streamId: string,
  action: "pause" | "resume" | "stop",
): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx(action, `${action} stream`);
  }
  return request<TxRequest>(`/streams/${streamId}/${action}/prepare`, { method: "POST" });
}

export async function prepareStreamWithdraw(): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx("withdraw", "Withdraw claimable");
  }
  return request<TxRequest>("/streams/withdraw/prepare", { method: "POST" });
}

export async function prepareAttest(
  impactId: string,
  type: "PARTICIPATED" | "WITNESSED",
): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx("attest", "Attest this action");
  }
  return request<TxRequest>(`/impact/${impactId}/attestations/prepare`, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

export async function prepareCampaignFund(campaignId: string, amountWei: string): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(300);
    return mockTx("fund", "Fund this campaign");
  }
  return request<TxRequest>(`/campaigns/${campaignId}/fund/prepare`, {
    method: "POST",
    body: JSON.stringify({ amountWei }),
  });
}

export async function prepareAnchorNote(payload: {
  title?: string;
  body: string;
  tipEnabled: boolean;
  streamEnabled: boolean;
}): Promise<TxRequest> {
  if (USE_MOCK) {
    await latency(400);
    return mockTx("anchorNote", "Anchor this note on Monad");
  }
  return request<TxRequest>("/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function trackTransaction(txHash: string): Promise<TrackedTransaction> {
  if (USE_MOCK) {
    await latency(100);
    return {
      txHash,
      kind: "TIP",
      status: "CONFIRMED",
      confirmations: 1,
      blockNumber: "1",
      explorerUrl: `${mock.mockConfig.chain.explorerBaseUrl}/tx/${txHash}`,
      error: null,
    };
  }
  return request<TrackedTransaction>(`/transactions/${txHash}`);
}

export type { ApiItemResponse, ApiListResponse };
