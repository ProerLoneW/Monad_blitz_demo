"use client";

import { create } from "zustand";

/** UI State（FRONTEND_DESIGN §24.1）：Sheet/Modal 开关与 Toast 队列。 */

export type ToastKind = "submitted" | "confirmed" | "failed";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  explorerUrl?: string | null;
};

type UiState = {
  createNoteOpen: boolean;
  openCreateNote: () => void;
  closeCreateNote: () => void;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => string;
  updateToast: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: string) => void;
};

let seq = 0;

export const useUiStore = create<UiState>((set) => ({
  createNoteOpen: false,
  openCreateNote: () => set({ createNoteOpen: true }),
  closeCreateNote: () => set({ createNoteOpen: false }),
  toasts: [],
  pushToast: (toast) => {
    const id = `toast_${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  updateToast: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
