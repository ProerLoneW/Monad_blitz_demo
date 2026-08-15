import { z } from "zod";

/**
 * Create Note 表单契约（FRONTEND_DESIGN §10.3）：
 * body 必填；>2000 字符提示转长文（此处作为硬上限）；monetized 时
 * Tip / Stream 至少开一个。草稿实时存 localStorage（§22.3 精神，
 * Modal 场景同样适用），关闭重开恢复，发布成功后清除。
 */

export const NOTE_TYPES = ["standard", "monetized", "impact"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const createNoteSchema = z
  .object({
    title: z.string().trim().max(120, "Keep the title under 120 characters").optional(),
    body: z
      .string()
      .trim()
      .min(1, "Write something first")
      .max(2000, "Over 2,000 characters — consider a long-form note"),
    type: z.enum(NOTE_TYPES),
    tipEnabled: z.boolean(),
    streamEnabled: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.type === "monetized" && !values.tipEnabled && !values.streamEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tipEnabled"],
        message: "Turn on at least one support option",
      });
    }
  });

export type CreateNoteValues = z.infer<typeof createNoteSchema>;

export const DEFAULT_VALUES: CreateNoteValues = {
  title: "",
  body: "",
  type: "standard",
  tipEnabled: true,
  streamEnabled: true,
};

const DRAFT_KEY = "pn:draft:create-note";

/** 关闭重开恢复草稿；解析失败一律回落到空草稿。 */
export function loadDraft(): CreateNoteValues {
  if (typeof window === "undefined") return DEFAULT_VALUES;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return DEFAULT_VALUES;
    const parsed: unknown = JSON.parse(raw);
    const result = createNoteSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_VALUES;
  } catch {
    return DEFAULT_VALUES;
  }
}

export function saveDraft(values: CreateNoteValues) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
  } catch {
    // 存储不可用（隐私模式等）时静默降级，不影响编辑
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 同上
  }
}

export function hasDraftContent(values: CreateNoteValues): boolean {
  return values.body.trim().length > 0 || (values.title?.trim().length ?? 0) > 0;
}
