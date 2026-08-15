"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 媒体条（§10.3 / P07）：72px 缩略图网格 + 虚线 ⊕ 添加位。
 * MVP：本地 file input 预览（objectURL），不上传；hover 缩略图出现 × 删除。
 */
type Preview = { id: string; url: string; name: string };

const MAX_ITEMS = 4;

export function MediaStrip() {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // 卸载时统一 revoke，避免内存泄漏； previews ref 跟随最新值
  const previewsRef = useRef<Preview[]>([]);
  previewsRef.current = previews;

  useEffect(
    () => () => {
      for (const p of previewsRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_ITEMS - previews.length;
    const next = Array.from(files)
      .slice(0, room)
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        url: URL.createObjectURL(file),
        name: file.name,
      }));
    if (next.length > 0) setPreviews((prev) => [...prev, ...next]);
  };

  const remove = (id: string) => {
    setPreviews((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-8">
      {previews.map((p) => (
        <div key={p.id} className="group relative size-18 overflow-hidden rounded-media">
          {/* eslint-disable-next-line @next/next/no-img-element -- 本地 objectURL 预览，不走 next/image */}
          <img src={p.url} alt={p.name} className="size-full object-cover" />
          <button
            type="button"
            aria-label={`Remove ${p.name}`}
            onClick={() => remove(p.id)}
            className="absolute right-4 top-4 hidden size-5 items-center justify-center rounded-full bg-ink/70 font-sans text-caption text-paper group-hover:flex"
          >
            ×
          </button>
        </div>
      ))}
      {previews.length < MAX_ITEMS ? (
        <button
          type="button"
          aria-label="Add media"
          onClick={() => inputRef.current?.click()}
          className="flex size-18 items-center justify-center rounded-media border border-dashed border-hairline-strong font-sans text-title text-smoke transition-colors duration-150 hover:border-smoke hover:text-graphite"
        >
          ⊕
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
