"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Toasts } from "@/components/ui/Toasts";
import { useUiStore } from "@/stores/ui";
import { WalletArea, useProfileNavigation } from "@/features/wallet/WalletArea";
import { CreateNoteModal } from "@/features/notes/CreateNoteModal";

/**
 * AppShell（§8.1 / §20.1）：左侧导航栏（240px / 72px 图标栏）+
 * 主内容列。顺序：Logo → Home → Discover → Create（唯一实心按钮）→
 * Profile → 底部钱包区。当前项 = 加粗 + 左侧 3px Iris 指示条。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const openCreateNote = useUiStore((s) => s.openCreateNote);
  const goProfile = useProfileNavigation();

  const nav = [
    { label: "Home", href: "/", active: pathname === "/" },
    { label: "Discover", href: "/discover", active: pathname === "/discover" },
  ];

  return (
    <div className="min-h-screen bg-paper">
      {/* 桌面侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-hairline bg-paper px-16 py-24 lg:flex">
        <Link
          href="/"
          className="px-8 font-serif text-title tracking-[-0.48px] text-ink no-underline"
        >
          ProofNote
        </Link>

        <nav className="mt-32 flex flex-col gap-4">
          {nav.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "relative rounded-input px-12 py-8 font-mono text-label uppercase tracking-[-0.28px] no-underline transition-colors duration-150",
                item.active ? "font-medium text-ink" : "text-graphite hover:text-ink",
              )}
            >
              {item.active && (
                <span aria-hidden className="absolute left-0 top-1/2 h-16 w-3 -translate-y-1/2 rounded-full bg-iris" />
              )}
              {item.label}
            </Link>
          ))}

          <Button className="mt-16 w-full" onClick={openCreateNote}>
            Create Note
          </Button>

          <button
            onClick={goProfile}
            className={cn(
              "relative rounded-input px-12 py-8 text-left font-mono text-label uppercase tracking-[-0.28px] transition-colors duration-150",
              pathname.startsWith("/profile") ? "font-medium text-ink" : "text-graphite hover:text-ink",
            )}
          >
            {pathname.startsWith("/profile") && (
              <span aria-hidden className="absolute left-0 top-1/2 h-16 w-3 -translate-y-1/2 rounded-full bg-iris" />
            )}
            Profile
          </button>
        </nav>

        <div className="mt-auto border-t border-hairline pt-16">
          <WalletArea />
        </div>
      </aside>

      {/* 窄屏顶栏（移动端适配本轮不做，仅保证可用） */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-hairline bg-paper px-16 py-12 lg:hidden">
        <Link href="/" className="font-serif text-title tracking-[-0.48px] text-ink no-underline">
          ProofNote
        </Link>
        <div className="flex items-center gap-16">
          <Button size="sm" onClick={openCreateNote}>
            Create
          </Button>
          <WalletArea />
        </div>
      </header>

      <main className="lg:pl-[240px]">{children}</main>

      <CreateNoteModal />
      <Toasts />
    </div>
  );
}
