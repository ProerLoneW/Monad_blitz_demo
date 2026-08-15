"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { getProfile, getProfileNotes } from "@/services/api";
import { NoteCard } from "@/features/notes/NoteCard";
import { EmptyState, ErrorCard, Skeleton } from "@/components/ui/States";
import { ProfileHero } from "./ProfileHero";
import { CreatorDashboardBar } from "./CreatorDashboardBar";
import { TwinStatColumns } from "./TwinStatColumns";
import { NOTE_TYPE_TABS, NoteTypeChips, type ProfileNoteTab } from "./NoteTypeChips";

/**
 * ProfileView（§10.6 / §15）：单主列 760px 居中（--layout-detail-content）。
 * 视觉层顺序：Hero →（本人）Dashboard 条 → Creation/Contribution 双栏 →
 * Chips → Notes 两列网格。访客视角为默认；本人 = wagmi 连接地址与
 * profile.walletAddress 大小写不敏感相等（§15.2/§15.3 隐私边界）。
 * 筛选 Chip 入 URL `?tab=`（§24.4 可分享状态入 URL）。
 * 零数据地址返回全零 profile，属正常退化形态（§20.2），不算错误。
 */

function parseTab(raw: string | null): ProfileNoteTab {
  return NOTE_TYPE_TABS.some((t) => t.value === raw) ? (raw as ProfileNoteTab) : "all";
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-(--layout-detail-content) px-24 py-64">
      <div className="flex items-center gap-24">
        <div
          aria-hidden
          className="shrink-0 animate-pulse rounded-full bg-hairline/60"
          style={{ width: 80, height: 80 }}
        />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-32 w-2/5" />
          <Skeleton className="mt-8 h-16 w-1/4" />
          <Skeleton className="mt-8 h-16 w-1/3" />
        </div>
      </div>
      <div className="mt-32 grid grid-cols-1 gap-32 sm:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="flex flex-col gap-16">
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-24 w-1/2" />
            <Skeleton className="h-24 w-1/2" />
            <Skeleton className="h-24 w-1/2" />
            <Skeleton className="h-24 w-1/2" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-32 h-24 w-2/3" />
      <div className="mt-24 grid grid-cols-1 gap-16 sm:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    </div>
  );
}

export function ProfileView({ addressOrHandle }: { addressOrHandle: string }) {
  const profileQuery = useQuery({
    queryKey: ["profile", addressOrHandle],
    queryFn: () => getProfile(addressOrHandle),
  });
  const notesQuery = useQuery({
    queryKey: ["profile-notes", addressOrHandle],
    queryFn: () => getProfileNotes(addressOrHandle),
  });
  const { address: connectedAddress } = useAccount();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab = parseTab(searchParams.get("tab"));
  const setTab = (next: ProfileNoteTab) => {
    router.replace(next === "all" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };

  if (profileQuery.isPending) return <ProfileSkeleton />;
  if (profileQuery.isError) {
    return (
      <div className="mx-auto max-w-(--layout-detail-content) px-24 py-64">
        <ErrorCard message={profileQuery.error.message} onRetry={() => profileQuery.refetch()} />
      </div>
    );
  }

  const profile = profileQuery.data;
  const isSelf =
    !!connectedAddress && connectedAddress.toLowerCase() === profile.walletAddress.toLowerCase();

  const notes = notesQuery.data ?? [];
  const visible =
    tab === "all" ? notes : notes.filter((n) => n.type === tab.toUpperCase());
  const activeTabLabel = NOTE_TYPE_TABS.find((t) => t.value === tab)?.label ?? "All";

  return (
    <div className="mx-auto max-w-(--layout-detail-content) px-24 py-64">
      <ProfileHero profile={profile} />

      {isSelf && (
        <div className="mt-24">
          <CreatorDashboardBar address={profile.walletAddress} />
        </div>
      )}

      <div className="mt-32">
        <TwinStatColumns stats={profile.stats} />
      </div>

      <div className="mt-32">
        <NoteTypeChips value={tab} onChange={setTab} />
      </div>

      <div className="mt-24">
        {notesQuery.isPending ? (
          <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : notesQuery.isError ? (
          <ErrorCard message={notesQuery.error.message} onRetry={() => notesQuery.refetch()} />
        ) : visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
            {visible.map((item) => (
              <NoteCard key={item.id} item={item} />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            body={
              isSelf
                ? "Notes you publish will appear here."
                : "This creator has not published any notes yet."
            }
          />
        ) : (
          <p className="py-32 text-center font-mono text-caption text-smoke">
            No {activeTabLabel.toLowerCase()} notes yet.
          </p>
        )}
      </div>
    </div>
  );
}
