"use client";

import type { CampaignExpense, CampaignFundingEntry } from "@proofnote/api-types";
import { monFromWei, relativeTime, truncateAddress } from "@/lib/format";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

/**
 * 双列账本（§10.5 第三视觉层）：Expenses | Funding。
 * Expense = 转账 + 用途 + 证据 三件套同时渲染（§14.3）；
 * 无证据 = Amber `Evidence: Missing` + 小号 outline 警示图标（不用红色）。
 */
export function Ledger({
  expenses,
  funding,
  supporterCount,
}: {
  expenses: CampaignExpense[];
  funding: CampaignFundingEntry[];
  /** Funding 列表的 supporter 总数（§6.5：12 supporters；列表本身可分页） */
  supporterCount: number;
}) {
  return (
    <div className="grid gap-32 md:grid-cols-2">
      <section>
        <h2 className="font-mono text-caption uppercase text-smoke">
          Expenses ({expenses.length})
        </h2>
        <div className="mt-8">
          {expenses.length === 0 ? (
            <p className="border-t border-hairline py-12 font-sans text-label text-smoke">
              No expenses recorded yet.
            </p>
          ) : (
            expenses.map((e) => <ExpenseItem key={e.id} expense={e} />)
          )}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-caption uppercase text-smoke">
          Funding ({supporterCount})
        </h2>
        <div className="mt-8">
          {funding.length === 0 ? (
            <p className="border-t border-hairline py-12 font-sans text-label text-smoke">
              No funding yet.
            </p>
          ) : (
            funding.map((f, i) => <FundingItem key={`${f.txHash}-${i}`} entry={f} />)
          )}
        </div>
      </section>
    </div>
  );
}

function ExpenseItem({ expense }: { expense: CampaignExpense }) {
  const hasEvidence = expense.evidence.length > 0;
  return (
    <div className="border-t border-hairline py-12">
      <div className="flex items-baseline gap-12">
        <span className="shrink-0 font-mono text-data text-graphite">
          {monFromWei(expense.amountWei)} MON
        </span>
        <span className="min-w-0 flex-1 font-sans text-label text-ink">{expense.purpose}</span>
        {hasEvidence ? (
          <span className="shrink-0 font-mono text-caption text-leaf">Evidence ✓</span>
        ) : (
          <span className="flex shrink-0 items-center gap-4 font-mono text-caption text-amber">
            <WarningIcon />
            Evidence: Missing
          </span>
        )}
        <ExplorerLink
          explorerUrl={expense.explorerUrl}
          path={expense.txHash ? `/tx/${expense.txHash}` : undefined}
          className="shrink-0"
        >
          {expense.txHash ? `${truncateAddress(expense.txHash)} ↗` : "tx ↗"}
        </ExplorerLink>
      </div>
      {!hasEvidence ? (
        <p className="mt-4 font-sans text-caption text-smoke">
          On-chain transfer sent — no evidence linked yet.
        </p>
      ) : null}
    </div>
  );
}

function FundingItem({ entry }: { entry: CampaignFundingEntry }) {
  return (
    <div className="flex items-baseline gap-12 border-t border-hairline py-12">
      <span className="font-mono text-data text-ink">{monFromWei(entry.amountWei)} MON</span>
      <span className="font-mono text-caption text-graphite">{truncateAddress(entry.from)}</span>
      <span className="font-mono text-caption text-smoke">{relativeTime(entry.createdAt)}</span>
      <ExplorerLink
        explorerUrl={entry.explorerUrl}
        path={`/tx/${entry.txHash}`}
        className="ml-auto shrink-0"
      >
        ↗
      </ExplorerLink>
    </div>
  );
}

/** 小号 outline 警示图标（Amber，不用红色）。 */
function WarningIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M6 1.5 11 10H1L6 1.5Z" strokeLinejoin="round" />
      <line x1="6" y1="4.5" x2="6" y2="7" strokeLinecap="round" />
      <circle cx="6" cy="8.6" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
