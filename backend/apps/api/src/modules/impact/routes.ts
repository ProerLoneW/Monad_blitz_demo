import { encodeFunctionData } from 'viem';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { EvidenceItem, TxRequest } from '@proofnote/api-types';
import { getAbi } from '@proofnote/contract-abis';
import { buildClaimManifest, buildEvidenceManifest } from '@proofnote/hash-utils';
import { domain, schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { newEvidenceId, newImpactId } from '../../lib/ids.js';
import { checksum } from '../../lib/money.js';
import { parseBody } from '../../lib/validation.js';
import { insertIntent } from '../../services/mock-chain.js';
import { beginIdempotency } from '../../plugins/idempotency.js';
import { newBytes32, createNoteWithManifest, requireOwnedMedia } from '../notes/service.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

const claimSchema = z.object({
  summary: z.string().max(500).optional(),
  who: z.string().max(120).optional(),
  action: z.string().min(1).max(500),
  when: z.string().max(40).optional(),
  whereText: z.string().max(120).optional(),
  beneficiary: z.string().max(200).optional(),
  resources: z.string().max(300).optional(),
  result: z.string().max(500).optional(),
});

const evidenceItemSchema = z.object({
  mediaId: z.string(),
  type: z.enum(['PHOTO', 'VIDEO', 'RECEIPT', 'INVOICE', 'DOCUMENT']).default('PHOTO'),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  capturedAt: z.string().datetime().optional(),
});

type EvidenceItemInput = z.infer<typeof evidenceItemSchema>;

const normalizeEvidenceItems = (items: EvidenceItemInput[] | undefined, mediaIds: string[] | undefined): EvidenceItemInput[] =>
  items && items.length > 0 ? items : (mediaIds ?? []).map((mediaId): EvidenceItemInput => ({ mediaId, type: 'PHOTO' }));

export async function createImpactInternal(
  app: FastifyInstance,
  p: {
    userId: string;
    address: string;
    title: string;
    body: string;
    mediaIds: string[];
    claim: z.infer<typeof claimSchema>;
    evidenceItems: Array<z.infer<typeof evidenceItemSchema>>;
    fundingEnabled: boolean;
  },
) {
  const db = requireDb(app);
  const { note } = await createNoteWithManifest(db, app.svc.storage, {
    authorUserId: p.userId,
    authorAddress: p.address,
    type: p.fundingEnabled ? 'CAMPAIGN' : 'IMPACT',
    title: p.title,
    body: p.body,
    mediaIds: p.mediaIds,
    tipEnabled: false,
    streamEnabled: false,
    topic: null,
  });

  const impactId = newImpactId();
  const impactKey = newBytes32();
  const claimEntries: Record<string, string | undefined> = {
    summary: p.claim.summary,
    who: p.claim.who,
    action: p.claim.action,
    when: p.claim.when,
    where: p.claim.whereText,
    beneficiary: p.claim.beneficiary,
    resources: p.claim.resources,
    result: p.claim.result,
  };
  const { claimHash } = buildClaimManifest({ impactId, claimant: p.address, claim: claimEntries });

  // evidence manifest v1
  const evidenceMedia = await requireOwnedMedia(db, p.evidenceItems.map((e) => e.mediaId), p.userId);
  const shaByMedia = new Map(evidenceMedia.map((m) => [m.id, m.sha256]));
  const { evidenceManifestHash, manifest } = buildEvidenceManifest({
    impactId,
    version: 1,
    items: p.evidenceItems.map((e) => ({
      mediaId: e.mediaId,
      sha256: shaByMedia.get(e.mediaId) ?? null,
      type: e.type,
      capturedAt: e.capturedAt ?? null,
    })),
  });
  const manifestKey = `manifests/impact-${impactId}.evidence.v1.json`;
  await app.svc.storage.putObject(manifestKey, 'application/json', Buffer.from(JSON.stringify(manifest, null, 2)));
  const manifestUri = app.svc.storage.publicUrl(manifestKey);

  await db.insert(schema.impactClaims).values({
    id: impactId,
    impactKey,
    noteId: note.id,
    authorAddress: p.address,
    claimJson: claimEntries,
    claimHash,
    verificationLevel: 'L0',
    fundingEnabled: p.fundingEnabled,
  });
  if (p.evidenceItems.length > 0) {
    await db.insert(schema.impactEvidence).values(
      p.evidenceItems.map((e) => ({
        id: newEvidenceId(),
        impactId,
        mediaId: e.mediaId,
        type: e.type,
        title: e.title ?? null,
        description: e.description ?? null,
        capturedAt: e.capturedAt ? new Date(e.capturedAt) : null,
      })),
    );
  }
  await db.insert(schema.impactManifests).values({
    impactId,
    version: 1,
    evidenceManifestHash,
    manifestUri,
  });

  // anchor tx：registerImpact（mock 落意图）
  let anchorTx: TxRequest;
  if (app.cfg.isMock) {
    await insertIntent(db, { userId: p.userId, kind: 'IMPACT_ANCHOR', entityId: impactId, params: {} });
    anchorTx = {
      chainId: app.cfg.env.CHAIN_ID,
      to: '0x0000000000000000000000000000000000000000',
      data: '0x',
      value: '0',
      functionName: 'registerImpact',
      description: 'Register impact claim',
      mock: true,
    };
  } else {
    const registry = app.cfg.contracts.impactRegistry;
    if (!registry) throw new AppError('CHAIN_NOT_CONFIGURED', 'ImpactRegistry not configured');
    anchorTx = {
      chainId: app.cfg.env.CHAIN_ID,
      to: registry as `0x${string}`,
      data: encodeFunctionData({
        abi: getAbi('impactRegistry'),
        functionName: 'registerImpact',
        args: [impactKey, note.noteKey as `0x${string}`, claimHash as `0x${string}`, evidenceManifestHash as `0x${string}`, manifestUri],
      }),
      value: '0',
      functionName: 'registerImpact',
      description: 'Register impact claim',
    };
  }

  const level = p.evidenceItems.length > 0 ? 'L1' : 'L0';
  return { note, impactId, impactKey, claimHash, evidenceManifestHash, anchorTx, initialLevel: level };
}

async function getImpactOrThrow(db: Db, impactId: string) {
  const impact = (await db.select().from(schema.impactClaims).where(eq(schema.impactClaims.id, impactId)).limit(1))[0];
  if (!impact) throw new AppError('IMPACT_NOT_FOUND');
  return impact;
}

export default async function impactRoutes(app: FastifyInstance) {
  // ── POST /impact-notes（SPEC §20.1）───────────────────────
  app.post(
    '/impact-notes',
    { preHandler: [app.authenticate, async (request, reply) => beginIdempotency(request, reply)] },
    async (request, reply) => {
      const body = parseBody(
        z.object({
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(50_000),
          mediaIds: z.array(z.string()).max(9).optional(),
          claim: claimSchema,
          evidenceMediaIds: z.array(z.string()).max(20).optional(),
          evidenceItems: z.array(evidenceItemSchema).max(20).optional(),
          fundingEnabled: z.boolean().optional(),
        }),
        request.body,
      );
      const evidenceItems = normalizeEvidenceItems(body.evidenceItems, body.evidenceMediaIds);

      const r = await createImpactInternal(app, {
        userId: request.user.sub,
        address: request.user.addr,
        title: body.title,
        body: body.body,
        mediaIds: body.mediaIds ?? [],
        claim: body.claim,
        evidenceItems,
        fundingEnabled: body.fundingEnabled ?? false,
      });

      return reply.code(201).send({
        data: {
          note: { id: r.note.id, noteKey: r.note.noteKey, type: r.note.type, status: r.note.status },
          impact: {
            id: r.impactId,
            claimHash: r.claimHash,
            evidenceManifestHash: r.evidenceManifestHash,
            verificationLevel: r.initialLevel,
          },
          anchorTx: r.anchorTx,
        },
      });
    },
  );

  // ── GET /impact/:impactId（SPEC §20.2）────────────────────
  app.get('/impact/:impactId', async (request) => {
    const db = requireDb(app);
    const { impactId } = request.params as { impactId: string };
    const impact = await getImpactOrThrow(db, impactId);

    const stats = (
      await db.select().from(schema.impactStats).where(eq(schema.impactStats.impactKey, impact.impactKey)).limit(1)
    )[0];
    const onchain = (
      await db.select().from(schema.impactsOnchain).where(eq(schema.impactsOnchain.impactKey, impact.impactKey)).limit(1)
    )[0];
    const evidenceRows = await db
      .select({ evidence: schema.impactEvidence, media: schema.media })
      .from(schema.impactEvidence)
      .innerJoin(schema.media, eq(schema.media.id, schema.impactEvidence.mediaId))
      .where(eq(schema.impactEvidence.impactId, impactId));

    const evidence: EvidenceItem[] = evidenceRows.map(({ evidence, media }) => ({
      id: evidence.id,
      mediaId: evidence.mediaId,
      type: evidence.type,
      title: evidence.title,
      description: evidence.description,
      capturedAt: evidence.capturedAt?.toISOString() ?? null,
      sha256: media.sha256,
      url: media.url,
    }));

    return {
      data: {
        id: impact.id,
        noteId: impact.noteId,
        claim: impact.claimJson,
        evidence,
        verification: {
          level: impact.verificationLevel,
          evidenceCount: stats?.evidenceCount ?? evidence.length,
          attestationCount: stats?.attestationCount ?? 0,
          trustedVerifierCount: 0,
          openChallengeCount: 0,
        },
        chain: {
          claimHash: impact.claimHash,
          evidenceManifestHash: onchain?.currentManifestHash ?? null,
          currentVersion: onchain?.currentVersion ?? 1,
          explorerUrl: onchain ? app.cfg.explorerUrl(onchain.txHash) : null,
        },
      },
    };
  });

  // ── POST /impact/:impactId/evidence（SPEC §21.1）──────────
  app.post('/impact/:impactId/evidence', { preHandler: [app.authenticate] }, async (request, reply) => {
    const db = requireDb(app);
    const { impactId } = request.params as { impactId: string };
    const impact = await getImpactOrThrow(db, impactId);
    if (impact.authorAddress !== request.user.addr) throw new AppError('IMPACT_NOT_OWNER');

    const body = parseBody(
      z.object({
        mediaIds: z.array(z.string()).max(20).optional(),
        items: z.array(evidenceItemSchema).max(20),
      }),
      request.body,
    );
    const items = normalizeEvidenceItems(body.items, body.mediaIds);

    // 当前版本 → v(n+1)（历史 manifest 永不覆盖）
    const current = (
      await db
        .select()
        .from(schema.impactManifests)
        .where(eq(schema.impactManifests.impactId, impactId))
        .orderBy(desc(schema.impactManifests.version))
        .limit(1)
    )[0];
    const currentVersion = current?.version ?? 1;
    const nextVersion = currentVersion + 1;

    const existingEvidence = await db
      .select({ evidence: schema.impactEvidence, media: schema.media })
      .from(schema.impactEvidence)
      .innerJoin(schema.media, eq(schema.media.id, schema.impactEvidence.mediaId))
      .where(eq(schema.impactEvidence.impactId, impactId));
    const newMedia = await requireOwnedMedia(db, items.map((i) => i.mediaId), request.user.sub);

    const allItems = [
      ...existingEvidence.map(({ evidence, media }) => ({
        mediaId: evidence.mediaId,
        sha256: media.sha256,
        type: evidence.type,
        capturedAt: evidence.capturedAt?.toISOString() ?? null,
      })),
      ...items.map((i) => ({
        mediaId: i.mediaId,
        sha256: newMedia.find((m) => m.id === i.mediaId)?.sha256 ?? null,
        type: i.type,
        capturedAt: i.capturedAt ?? null,
      })),
    ];

    const { evidenceManifestHash, manifest } = buildEvidenceManifest({ impactId, version: nextVersion, items: allItems });
    const manifestKey = `manifests/impact-${impactId}.evidence.v${nextVersion}.json`;
    await app.svc.storage.putObject(manifestKey, 'application/json', Buffer.from(JSON.stringify(manifest, null, 2)));
    const manifestUri = app.svc.storage.publicUrl(manifestKey);

    await db.insert(schema.impactEvidence).values(
      items.map((i) => ({
        id: newEvidenceId(),
        impactId,
        mediaId: i.mediaId,
        type: i.type,
        title: i.title ?? null,
        description: i.description ?? null,
        capturedAt: i.capturedAt ? new Date(i.capturedAt) : null,
      })),
    );
    await db.insert(schema.impactManifests).values({
      impactId,
      version: nextVersion,
      evidenceManifestHash,
      manifestUri,
    });
    await domain.recomputeImpactLevel(db, impact.impactKey);

    let tx: TxRequest;
    if (app.cfg.isMock) {
      await insertIntent(db, {
        userId: request.user.sub,
        kind: 'EVIDENCE_UPDATE',
        entityId: impactId,
        params: { impactKey: impact.impactKey, version: String(nextVersion), hash: evidenceManifestHash, uri: manifestUri },
      });
      tx = {
        chainId: app.cfg.env.CHAIN_ID,
        to: '0x0000000000000000000000000000000000000000',
        data: '0x',
        value: '0',
        functionName: 'updateEvidenceManifest',
        description: 'Append evidence (new manifest version)',
        mock: true,
      };
    } else {
      const registry = app.cfg.contracts.impactRegistry;
      if (!registry) throw new AppError('CHAIN_NOT_CONFIGURED', 'ImpactRegistry not configured');
      tx = {
        chainId: app.cfg.env.CHAIN_ID,
        to: registry as `0x${string}`,
        data: encodeFunctionData({
          abi: getAbi('impactRegistry'),
          functionName: 'updateEvidenceManifest',
          args: [impact.impactKey as `0x${string}`, BigInt(nextVersion), evidenceManifestHash as `0x${string}`, manifestUri],
        }),
        value: '0',
        functionName: 'updateEvidenceManifest',
        description: 'Append evidence (new manifest version)',
      };
    }

    return reply.code(201).send({
      data: {
        manifestVersion: nextVersion,
        manifestHash: evidenceManifestHash,
        tx,
      },
    });
  });
}
