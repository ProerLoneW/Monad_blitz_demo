"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { truncateAddress } from "@/lib/format";
import { Button } from "@/components/ui/Button";

/** 侧栏底部钱包区（§8.1）：未连接 = Connect wallet 文字钮；已连接 = 绿点 + 地址缩写 + 网络。 */
export function WalletArea() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isConnected || !address) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isPending}
        className="font-mono text-label uppercase tracking-[-0.28px] text-iris transition-colors duration-150 hover:text-iris-strong"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const wrongNetwork = chainId !== 10143;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-8">
        <span
          aria-hidden
          className={`inline-block h-8 w-8 rounded-full ${wrongNetwork ? "bg-amber" : "bg-leaf"}`}
        />
        <span className="font-mono text-caption text-ink">{truncateAddress(address)}</span>
      </div>
      <span className="font-mono text-caption text-smoke">
        {wrongNetwork ? "Wrong network — switch to Monad" : "Monad Testnet"}
      </span>
      <button
        onClick={() => disconnect()}
        className="text-left font-mono text-caption text-smoke transition-colors duration-150 hover:text-ink"
      >
        Disconnect
      </button>
    </div>
  );
}

/** 连接钱包后主按钮（供 Sheet/Detail CTA 复用）。 */
export function ConnectPrimaryButton({ label = "Connect wallet" }: { label?: string }) {
  const { connect, connectors, isPending } = useConnect();
  return (
    <Button onClick={() => connect({ connector: connectors[0] })} disabled={isPending}>
      {isPending ? "Connecting…" : label}
    </Button>
  );
}

/** Profile 导航：本人 Profile 是白名单触发点（§16.1）——未连接先连接再进入。 */
export function useProfileNavigation() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (isConnected && address && sessionStorage.getItem("pn:nav-profile") === "1") {
      sessionStorage.removeItem("pn:nav-profile");
      router.push(`/profile/${address}`);
    }
  }, [isConnected, address, router]);

  return () => {
    if (isConnected && address) {
      router.push(`/profile/${address}`);
    } else {
      sessionStorage.setItem("pn:nav-profile", "1");
      connect({ connector: connectors[0] });
    }
  };
}
