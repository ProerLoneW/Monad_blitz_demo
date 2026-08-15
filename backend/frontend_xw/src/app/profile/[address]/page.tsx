import { Suspense } from "react";
import { ProfileView } from "@/features/creator/ProfileView";

/**
 * P06 Creator Profile（§10.6 / §15）。路由按任务文档为 `/profile/[address]`
 * （FRONTEND_DESIGN 的 `/[handle]` 不用）；data-access 层 address/handle 均可解析。
 * Suspense 边界：ProfileView 内 useSearchParams 需要（Next 14 静态渲染约束）。
 */
export default function ProfilePage({ params }: { params: { address: string } }) {
  return (
    <Suspense fallback={null}>
      <ProfileView addressOrHandle={params.address} />
    </Suspense>
  );
}
