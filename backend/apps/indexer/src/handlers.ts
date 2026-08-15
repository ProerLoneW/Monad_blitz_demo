import { domain, schema, type Db } from '@proofnote/db';

/**
 * 事件 → domain 层分发（后端开发文档 §5.5.2）。
 * 全部经 chain_events 去重后调用；args 为 viem decodeEventLog 结果。
 */
export async function dispatch(
  db: Db,
  p: { eventName: string; args: Record<string, unknown>; txHash: string; blockTime: Date; blockNumber: string; feeRecipient?: string },
): Promise<void> {
  const a = p.eventName;
  const args = p.args;
  const s = (v: unknown): string => String(v);
  const big = (v: unknown): string => BigInt(v as bigint | number | string).toString();

  switch (a) {
    case 'NoteRegistered':
      await domain.publishNote(db, {
        noteKey: s(args.noteKey),
        creator: s(args.creator),
        contentHash: s(args.contentHash),
        manifestUri: s(args.manifestURI),
        txHash: p.txHash,
        registeredAt: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'TipSent':
      await domain.applyTip(db, {
        noteKey: s(args.noteKey),
        supporter: s(args.supporter),
        creator: s(args.creator),
        grossWei: big(args.grossAmount),
        protocolFeeWei: big(args.protocolFee),
        creatorAmountWei: big(args.creatorAmount),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'StreamCreated':
      await domain.applyStreamCreate(db, {
        streamId: big(args.streamId),
        noteKey: s(args.noteKey),
        fan: s(args.fan),
        creator: s(args.creator),
        rateWeiPerSecond: big(args.ratePerSecond),
        budgetWei: big(args.budget),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'StreamPaused':
      await domain.applyStreamPause(db, {
        streamId: big(args.streamId),
        accruedWei: big(args.accrued),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'StreamResumed':
      await domain.applyStreamResume(db, {
        streamId: big(args.streamId),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'StreamSettled':
      await domain.applyStreamSettle(db, {
        streamId: big(args.streamId),
        accruedWei: big(args.accrued),
        creatorCreditWei: big(args.creatorCredit),
        fanRefundWei: big(args.fanRefund),
        protocolFeeWei: big(args.protocolFee),
        feeRecipient: p.feeRecipient,
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'CreditWithdrawn':
      await domain.applyCreditWithdrawn(db, {
        account: s(args.account),
        amountWei: big(args.amount),
        txHash: p.txHash,
      });
      return;
    case 'ImpactRegistered':
      await domain.publishImpact(db, {
        impactKey: s(args.impactKey),
        noteKey: s(args.noteKey),
        creator: s(args.creator),
        claimHash: s(args.claimHash),
        evidenceManifestHash: s(args.evidenceManifestHash),
        manifestUri: s(args.manifestURI),
        txHash: p.txHash,
        registeredAt: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'EvidenceManifestUpdated':
      await domain.applyEvidenceManifestUpdate(db, {
        impactKey: s(args.impactKey),
        version: Number(args.version),
        evidenceManifestHash: s(args.evidenceManifestHash),
        manifestUri: s(args.manifestURI),
        txHash: p.txHash,
        blockNumber: p.blockNumber,
      });
      return;
    case 'Attested': {
      const typeCode = Number(args.attestationType);
      await domain.applyAttestation(db, {
        impactKey: s(args.impactKey),
        attester: s(args.attester),
        attestationType: typeCode === 1 ? 'WITNESSED' : 'PARTICIPATED',
        statementHash: s(args.statementHash),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    }
    case 'CampaignCreated':
      await domain.applyCampaignCreate(db, {
        campaignKey: s(args.campaignKey),
        impactKey: s(args.impactKey),
        organizer: s(args.organizer),
        treasuryAddress: s(args.treasury),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'CampaignFunded':
      await domain.applyCampaignFunded(db, {
        campaignKey: s(args.campaignKey),
        supporter: s(args.supporter),
        amountWei: big(args.amount),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    case 'CampaignSpent':
      await domain.applyCampaignSpent(db, {
        campaignKey: s(args.campaignKey),
        recipient: s(args.recipient),
        amountWei: big(args.amount),
        purposeHash: s(args.purposeHash),
        evidenceHash: s(args.evidenceHash),
        txHash: p.txHash,
        blockTime: p.blockTime,
        blockNumber: p.blockNumber,
      });
      return;
    default:
      return;
  }
}
