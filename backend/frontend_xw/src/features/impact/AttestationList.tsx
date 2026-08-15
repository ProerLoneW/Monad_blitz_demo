import type { Attestation } from "@proofnote/api-types";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { relativeTime, truncateAddress } from "@/lib/format";

/**
 * AttestationList（§13.5）：Attestation Chip —— Leaf Tint 底、1px Leaf 30% 边、
 * mono 12px Leaf、20px 头像左内联；无 Profile 的地址退化为截断地址身份
 * （WalletIdentity 退化）；自背书行尾 `Self-related` 灰签。
 */
export function AttestationList({
  attestations,
  authorAddress,
}: {
  attestations: Attestation[];
  authorAddress: string;
}) {
  if (attestations.length === 0) {
    return (
      <p className="font-mono text-caption leading-[1.6] text-smoke">
        No attestations yet — participants can attest from their wallets.
      </p>
    );
  }

  return (
    <ul className="flex flex-col items-start gap-8">
      {attestations.map((att) => {
        const profile = att.attester.profile;
        const name =
          profile?.displayName || profile?.handle || truncateAddress(att.attester.address);
        const isSelf =
          att.attester.address.toLowerCase() === authorAddress.toLowerCase();

        return (
          <li key={att.id} className="flex items-center gap-8">
            <span className="inline-flex items-center gap-8 rounded-pill border border-leaf/30 bg-leaf-tint py-4 pl-4 pr-12 font-mono text-caption text-leaf">
              {profile ? (
                <Avatar
                  size={20}
                  profile={{
                    walletAddress: att.attester.address,
                    handle: profile.handle,
                    displayName: profile.displayName,
                  }}
                />
              ) : (
                <Avatar size={20} profile={{ address: att.attester.address }} />
              )}
              <span className="whitespace-nowrap">
                {name} · {att.type === "PARTICIPATED" ? "participated" : "witnessed"} ·{" "}
                {relativeTime(att.createdAt)}
              </span>
              {att.explorerUrl ? <ExplorerLink explorerUrl={att.explorerUrl}>↗</ExplorerLink> : null}
            </span>
            {isSelf ? <Badge variant="neutral">Self-related</Badge> : null}
          </li>
        );
      })}
    </ul>
  );
}
