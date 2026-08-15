"use client";

import { useState } from "react";
import type { EvidenceItem } from "@proofnote/api-types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { absoluteTime, truncateAddress } from "@/lib/format";

/** 文档类证据显示文件图标而非缩略预览（§13.4：发票/收据常含敏感信息）。 */
function DocumentIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-smoke"
    >
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h7M9 17h7" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-smoke"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

/**
 * EvidencePreview（§13.4）：96×96 横滑缩略占位 + 标题 + hash 截断，
 * 末尾 "view all" 打开全量列表 Modal（单条元信息 + sha256 复制）。
 * 无真实图源：渲染 hairline 占位容器，不编造图片 URL。
 */
export function EvidencePreview({ evidence }: { evidence: EvidenceItem[] }) {
  const [allOpen, setAllOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center gap-12 overflow-x-auto pb-4 [scroll-snap-type:x_mandatory]">
        {evidence.map((item) => {
          const isDoc = item.type === "DOCUMENT" || item.type === "RECEIPT" || item.type === "INVOICE";
          return (
            <div key={item.id} className="w-[96px] shrink-0 [scroll-snap-align:start]">
              <div
                aria-hidden
                className="flex h-[96px] w-[96px] items-center justify-center rounded-input border border-hairline bg-paper"
              >
                {isDoc ? <DocumentIcon /> : <PhotoIcon />}
              </div>
              <p className="mt-8 truncate font-sans text-caption leading-[1.4] text-graphite">
                {item.title ?? item.type}
              </p>
              {item.sha256 ? (
                <p className="truncate font-mono text-caption leading-[1.4] text-smoke">
                  {truncateAddress(item.sha256)}
                </p>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setAllOpen(true)}
          className="shrink-0 self-center font-mono text-caption text-graphite transition-colors duration-150 hover:text-ink"
        >
          + view all
        </button>
      </div>

      <Modal open={allOpen} onClose={() => setAllOpen(false)} width={480}>
        <h2 className="font-serif text-title tracking-[-0.48px] text-ink">Evidence</h2>
        <ul className="mt-24 flex flex-col gap-16">
          {evidence.map((item) => (
            <li key={item.id} className="flex items-start gap-12">
              <span
                aria-hidden
                className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-input border border-hairline bg-paper"
              >
                {item.type === "PHOTO" ? <PhotoIcon /> : <DocumentIcon />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-sans text-label text-ink">{item.title ?? item.type}</p>
                <p className="mt-4 font-mono text-caption text-smoke">
                  {item.type}
                  {item.capturedAt ? ` · ${absoluteTime(item.capturedAt)}` : ""}
                </p>
                {item.sha256 ? (
                  <p className="mt-4 flex items-center gap-8 font-mono text-caption text-smoke">
                    <span className="truncate">{truncateAddress(item.sha256)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(item.sha256 ?? "");
                        setCopiedId(item.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      className="shrink-0 text-iris transition-colors duration-150 hover:text-iris-strong"
                    >
                      {copiedId === item.id ? "Copied ✓" : "Copy"}
                    </button>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-24 flex justify-end">
          <Button variant="ghost" onClick={() => setAllOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}
