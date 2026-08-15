import type { ImpactClaim } from "@proofnote/api-types";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { truncateAddress } from "@/lib/format";

/**
 * ImpactClaimBlock（§13.2）：Claim 是"声明"不是事实 —— 引用块语言，
 * 左侧 2px Leaf 竖条 + 缩进，与正文明确区分；结构化字段键值小字，
 * 缺省不渲染；块尾固定一行 claim hash 核验链接。
 */
export function ImpactClaimBlock({
  claim,
  claimText,
  claimHash,
}: {
  claim: ImpactClaim;
  claimText: string;
  claimHash: `0x${string}`;
}) {
  const meta: Array<[string, string | undefined]> = [
    ["When", claim.when],
    ["Where", claim.whereText],
    ["Participants", claim.who],
    ["Resources", claim.resources],
    ["Result", claim.result],
  ];
  const visible = meta.filter((pair): pair is [string, string] => Boolean(pair[1]));

  return (
    <figure className="border-l-2 border-leaf pl-20">
      <blockquote className="font-sans text-body leading-[1.6] text-ink">
        {claimText || claim.summary || claim.action}
      </blockquote>

      {visible.length > 0 ? (
        <figcaption className="mt-12 flex flex-wrap gap-x-8 gap-y-4 font-mono text-caption leading-[1.5]">
          {visible.map(([key, value], i) => (
            <span key={key}>
              <span className="text-smoke">{key}</span>{" "}
              <span className="text-graphite">{value}</span>
              {i < visible.length - 1 ? <span className="text-smoke"> ·</span> : null}
            </span>
          ))}
        </figcaption>
      ) : null}

      <div className="mt-12">
        <ExplorerLink path={`/tx/${claimHash}`}>
          Claim anchored {truncateAddress(claimHash)} ↗
        </ExplorerLink>
      </div>
    </figure>
  );
}
