"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useUiStore } from "@/stores/ui";
import { useWalletTx } from "@/features/wallet/useWalletTx";
import { prepareAnchorNote } from "@/services/api";
import { truncateAddress } from "@/lib/format";
import {
  clearDraft,
  createNoteSchema,
  loadDraft,
  saveDraft,
  type CreateNoteValues,
  type NoteType,
} from "./composer/schema";
import { NoteTypePicker } from "./composer/NoteTypePicker";
import { AccordionSection } from "./composer/AccordionSection";
import { Switch } from "./composer/Switch";
import { MediaStrip } from "./composer/MediaStrip";

/**
 * Create Note Modal（P07 / FRONTEND_DESIGN §10.3）— 全局 720px Modal，
 * 由 uiStore.createNoteOpen 控制。普通发布零门槛；Monetization / Impact /
 * Funding 为渐进手风琴增强项。发布走唯一写路径 useWalletTx（anchor），
 * 按钮文案随状态机切换（§21.9）；草稿实时存 localStorage，发布成功清除。
 */
export function CreateNoteModal() {
  const open = useUiStore((s) => s.createNoteOpen);
  const close = useUiStore((s) => s.closeCreateNote);
  return (
    <Modal open={open} onClose={close}>
      <ComposerBody onClose={close} />
    </Modal>
  );
}

/** Monetization 拆分说明（P07；全局配置无此字段，MVP 固定文案）。 */
const SPLIT_CAPTION = "98% to you · 2% protocol";

function ComposerBody({ onClose }: { onClose: () => void }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { state, error, run, reset } = useWalletTx({
    kind: "anchor",
    entityId: "draft",
    invalidateKeys: [["feed"]],
  });

  const form = useForm<CreateNoteValues>({
    resolver: zodResolver(createNoteSchema),
    mode: "onChange",
    defaultValues: loadDraft(),
  });
  const { register, handleSubmit, setValue, watch, getValues, formState } = form;

  const type = watch("type");
  const title = watch("title") ?? "";
  const body = watch("body");
  const tipEnabled = watch("tipEnabled");
  const streamEnabled = watch("streamEnabled");

  const [sections, setSections] = useState({ monetization: false, impact: false });
  const bodyAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyField = register("body");

  // 草稿实时持久化（§22.3）：每次变更整体落盘
  useEffect(() => {
    const sub = form.watch(() => saveDraft(getValues()));
    return () => sub.unsubscribe();
  }, [form, getValues]);

  // 恢复的草稿需要立即校验，否则 isValid 停留在 false 禁用 Publish
  useEffect(() => {
    void form.trigger();
  }, [form]);

  // 重开时清掉上一轮遗留的终态实例（CONFIRMED 停留期内被 ESC 关闭的场景）
  const initialTxState = useRef(state).current;
  useEffect(() => {
    if (initialTxState === "CONFIRMED" || initialTxState === "FAILED") reset();
  }, [initialTxState, reset]);

  // textarea 自动增高（§10.3）
  useEffect(() => {
    const el = bodyAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  // CONFIRMED 后停留 800ms 关闭并清空草稿（§21.9）
  useEffect(() => {
    if (state !== "CONFIRMED") return;
    clearDraft();
    const timer = setTimeout(() => {
      reset();
      onClose();
    }, 800);
    return () => clearTimeout(timer);
  }, [state, reset, onClose]);

  const selectType = (next: NoteType) => {
    setValue("type", next, { shouldDirty: true, shouldValidate: true });
    if (next === "standard" || next === "impact") {
      // MVP：payload 仅 monetized 携带开关，非 monetized 一律归零保持所见即所得
      setValue("tipEnabled", false, { shouldDirty: true });
      setValue("streamEnabled", false, { shouldDirty: true });
    }
    if (next !== "impact") {
      setSections((s) => ({ ...s, impact: false }));
    }
    if (next === "monetized") {
      setValue("tipEnabled", true, { shouldDirty: true, shouldValidate: true });
      setValue("streamEnabled", true, { shouldDirty: true, shouldValidate: true });
      setSections((s) => ({ ...s, monetization: true }));
    }
    if (next === "impact") {
      setSections((s) => ({ ...s, impact: true }));
    }
  };

  const toggleSwitch = (key: "tipEnabled" | "streamEnabled", next: boolean) => {
    setValue(key, next, { shouldDirty: true, shouldValidate: true });
    const other = key === "tipEnabled" ? streamEnabled : tipEnabled;
    if (next && type === "standard") {
      setValue("type", "monetized", { shouldDirty: true, shouldValidate: true });
    }
    if (!next && !other && type === "monetized") {
      setValue("type", "standard", { shouldDirty: true, shouldValidate: true });
    }
  };

  const busy =
    state === "PREPARING" ||
    state === "WAITING_WALLET" ||
    state === "SUBMITTED" ||
    state === "CONFIRMED";

  const primaryLabel = !isConnected
    ? connecting
      ? "Connecting…"
      : "Connect wallet"
    : state === "PREPARING"
      ? "Preparing…"
      : state === "WAITING_WALLET"
        ? "Confirm in wallet"
        : state === "SUBMITTED"
          ? "Anchoring…"
          : state === "CONFIRMED"
            ? "Published ✓"
            : "Publish";

  const onPrimary = () => {
    if (!isConnected) {
      const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
      if (injected) connect({ connector: injected });
      return;
    }
    void handleSubmit(async (values) => {
      try {
        await run(() =>
          prepareAnchorNote({
            title: values.title?.trim() ? values.title.trim() : undefined,
            body: values.body.trim(),
            tipEnabled: values.type === "monetized" ? values.tipEnabled : false,
            streamEnabled: values.type === "monetized" ? values.streamEnabled : false,
          }),
        );
      } catch {
        // 失败态由 tx store + Toast 表达，按钮回落可重试
      }
    })();
  };

  const monetizationSummary =
    type !== "monetized"
      ? "Off"
      : tipEnabled && streamEnabled
        ? "Tips on · Stream on"
        : tipEnabled
          ? "Tips on"
          : streamEnabled
            ? "Stream on"
            : "Off";

  const showBodyError = Boolean(
    formState.errors.body && (formState.touchedFields.body || formState.submitCount > 0),
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-16">
        <h2 className="font-serif text-note-title tracking-[-0.64px] text-ink">Create Note</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-32 items-center justify-center font-sans text-title text-smoke transition-colors duration-150 hover:text-ink"
        >
          ×
        </button>
      </div>

      {/* 作者行：当前连接地址，未连接退化为 Alice 占位 */}
      <div className="mt-20 flex items-center gap-12">
        <Avatar
          size={40}
          profile={
            isConnected && address
              ? { address }
              : { walletAddress: "", handle: "alice", displayName: "Alice" }
          }
        />
        <span className="font-mono text-label text-graphite">
          {isConnected && address ? truncateAddress(address) : "Alice"}
        </span>
      </div>

      {/* 正文 */}
      <div className="mt-16">
        <textarea
          {...bodyField}
          ref={(el) => {
            bodyField.ref(el);
            bodyAreaRef.current = el;
          }}
          rows={3}
          placeholder="Share something worth anchoring…"
          className="w-full resize-none bg-transparent font-sans text-body leading-[1.6] text-ink placeholder:text-smoke focus:outline-none"
        />
        {showBodyError ? (
          <p className="mt-8 font-mono text-caption text-red">{formState.errors.body?.message}</p>
        ) : body.length > 1800 ? (
          <p className="mt-8 text-right font-mono text-caption text-smoke">
            {body.length.toLocaleString("en-US")} / 2,000
          </p>
        ) : null}
      </div>

      {/* 标题（可选，serif） */}
      <input
        {...register("title")}
        type="text"
        placeholder="Title (optional)"
        className="mt-12 w-full bg-transparent font-serif text-title tracking-[-0.48px] text-ink placeholder:text-smoke focus:outline-none"
      />
      {formState.errors.title && (formState.touchedFields.title || formState.submitCount > 0) ? (
        <p className="mt-8 font-mono text-caption text-red">{formState.errors.title.message}</p>
      ) : null}

      {/* 媒体：72px 缩略图 + ⊕ 添加位（本地预览，不上传） */}
      <div className="mt-16">
        <MediaStrip />
      </div>

      {/* Note 类型 pill radio */}
      <div className="mt-20">
        <NoteTypePicker value={type} onChange={selectType} />
      </div>

      {/* 渐进增强手风琴 */}
      <div className="mt-20">
        <AccordionSection
          label="Monetization"
          summary={monetizationSummary}
          open={sections.monetization}
          onToggle={() => setSections((s) => ({ ...s, monetization: !s.monetization }))}
        >
          <div className="flex flex-col gap-12">
            <div className="flex items-center justify-between gap-16">
              <span className="font-sans text-label text-ink">Accept Tips</span>
              <Switch
                label="Accept Tips"
                checked={tipEnabled}
                disabled={type === "impact"}
                onChange={(v) => toggleSwitch("tipEnabled", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-16">
              <span className="font-sans text-label text-ink">Accept Stream Support</span>
              <Switch
                label="Accept Stream Support"
                checked={streamEnabled}
                disabled={type === "impact"}
                onChange={(v) => toggleSwitch("streamEnabled", v)}
              />
            </div>
            <p className="font-mono text-caption text-smoke">{SPLIT_CAPTION}</p>
            {formState.errors.tipEnabled && formState.submitCount > 0 ? (
              <p className="font-mono text-caption text-red">{formState.errors.tipEnabled.message}</p>
            ) : null}
          </div>
        </AccordionSection>

        <AccordionSection
          label="Impact"
          summary="Record a real-world action with evidence"
          open={sections.impact}
          onToggle={() => setSections((s) => ({ ...s, impact: !s.impact }))}
          disabled={type !== "impact"}
        >
          <p className="font-mono text-caption text-smoke">
            Claim and evidence fields ship with the Impact milestone.
          </p>
        </AccordionSection>

        <AccordionSection
          label="Funding"
          summary="Set a funding goal (requires Impact)"
          open={false}
          onToggle={() => undefined}
          disabled
        />
      </div>

      {/* Footer：草稿/锚定说明 + 全页唯一实心按钮 */}
      <div className="mt-8 border-t border-hairline pt-20">
        <div className="flex items-center justify-between gap-16">
          <p className="font-mono text-caption text-smoke">
            {body.trim() || title.trim()
              ? "Draft saved · Publishing will anchor this note on Monad"
              : "Publishing will anchor this note on Monad"}
          </p>
          <Button
            onClick={onPrimary}
            disabled={!isConnected ? connecting : busy || !formState.isValid}
          >
            {primaryLabel}
          </Button>
        </div>
        {state === "FAILED" && error ? (
          <p className="mt-8 text-right font-mono text-caption text-red">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
