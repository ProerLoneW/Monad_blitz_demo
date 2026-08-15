"use client";

import { Modal } from "@/components/ui/Modal";
import { useUiStore } from "@/stores/ui";

/**
 * Create Note Modal（P07）— 占位实现，见 features/notes/CreateNoteModal
 * 完整规格：FRONTEND_DESIGN §10.3 / PROTOTYPE_PROMPTS P07。
 */
export function CreateNoteModal() {
  const open = useUiStore((s) => s.createNoteOpen);
  const close = useUiStore((s) => s.closeCreateNote);
  return (
    <Modal open={open} onClose={close}>
      <h2 className="font-serif text-note-title tracking-[-0.64px] text-ink">Create Note</h2>
      <p className="mt-16 font-sans text-body text-graphite">Composer placeholder.</p>
    </Modal>
  );
}
