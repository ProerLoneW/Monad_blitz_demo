"use client";

import { useState } from "react";
import type { Profile } from "@/types";
import { truncateAddress } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";

/**
 * ProfileHero（§10.6 第一视觉层）：80px Avatar + displayName（serif 32/400）
 * + @handle + 截断地址 + ⧉ 复制 + bio。无 Profile 的地址退化为地址身份
 * （§20.2 WalletIdentity：serif 名即截断地址，无 handle/bio 行）。
 */
export function ProfileHero({ profile }: { profile: Profile }) {
  const [copied, setCopied] = useState(false);

  const hasIdentity = profile.displayName !== "" || profile.handle !== "";
  const name = hasIdentity
    ? profile.displayName || `@${profile.handle}`
    : truncateAddress(profile.walletAddress);

  const copyAddress = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(profile.walletAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <header className="flex items-center gap-24">
      <Avatar profile={profile} size={80} />
      <div className="min-w-0">
        <h1 className="font-serif text-note-title font-normal leading-[1.2] tracking-[-0.48px] text-ink">
          {name}
        </h1>
        <div className="mt-4 flex items-center gap-8 font-mono text-label text-smoke">
          {profile.handle !== "" && <span>@{profile.handle}</span>}
          {profile.handle !== "" && <span aria-hidden>·</span>}
          <span>{truncateAddress(profile.walletAddress)}</span>
          <button
            onClick={copyAddress}
            aria-label="Copy address"
            className="transition-colors duration-150 hover:text-ink"
          >
            {copied ? "Copied" : "⧉"}
          </button>
        </div>
        {profile.bio !== "" && (
          <p className="mt-8 font-sans text-body leading-[1.6] text-graphite">{profile.bio}</p>
        )}
      </div>
    </header>
  );
}
