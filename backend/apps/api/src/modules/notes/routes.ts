import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { domain, schema, type Db } from '@proofnote/db';
import { AppError } from '../../lib/errors.js';
import { txHashSchema, parseBody } from '../../lib/validation.js';
import { beginIdempotency } from '../../plugins/idempotency.js';
import { verifyAnchorTx } from '../../services/tx-verify.js';
import { assembleNote, buildAnchorTx, createNoteWithManifest, getNoteById } from './service.js';
import { z } from 'zod';

function requireDb(app: FastifyInstance): Db {
  if (!app.svc.db) throw new AppError('INTERNAL_ERROR', 'Database not configured');
  return app.svc.db;
}

export default async function noteRoutes(app: FastifyInstance) {
  // ── POST /notes（SPEC §12.1）──────────────────────────────
  app.post(
    '/notes',
    { preHandler: [app.authenticate, async (request, reply) => beginIdempotency(request, reply)] },
    async (request, reply) => {
      const db = requireDb(app);
      const body = parseBody(
        z.object({
          type: z.enum(['STANDARD', 'MONETIZED']),
          title: z.string().max(200).optional(),
          body: z.string().min(1).max(50_000),
          mediaIds: z.array(z.string()).max(9).optional(),
          monetization: z
            .object({ tipEnabled: z.boolean().optional(), streamEnabled: z.boolean().optional() })
            .optional(),
          topic: z.string().max(32).optional(),
        }),
        request.body,
      );

      const monetized = body.type === 'MONETIZED';
      const tipEnabled = monetized && (body.monetization?.tipEnabled ?? true);
      const streamEnabled = monetized && (body.monetization?.streamEnabled ?? true);

      const { note, contentHash, manifestUri } = await createNoteWithManifest(db, app.svc.storage, {
        authorUserId: request.user.sub,
        authorAddress: request.user.addr,
        type: body.type,
        title: body.title ?? null,
        body: body.body,
        mediaIds: body.mediaIds ?? [],
        tipEnabled,
        streamEnabled,
        topic: body.topic ?? null,
      });

      const anchorTx = await buildAnchorTx(
        db,
        app.cfg.isMock,
        app.cfg.contracts.noteRegistry,
        note,
        request.user.sub,
        app.cfg.env.CHAIN_ID,
      );

      return reply.code(201).send({
        data: {
          note: {
            id: note.id,
            noteKey: note.noteKey,
            status: note.status,
            contentHash,
            manifestUri,
          },
          anchorTx,
        },
      });
    },
  );

  // ── POST /notes/:noteId/confirm-anchor（SPEC §12.2）───────
  app.post('/notes/:noteId/confirm-anchor', { preHandler: [app.authenticate] }, async (request) => {
    const db = requireDb(app);
    const { noteId } = request.params as { noteId: string };
    const body = parseBody(z.object({ txHash: txHashSchema }), request.body);

    const note = await getNoteById(db, noteId);
    if (!note) throw new AppError('NOTE_NOT_FOUND');
    if (note.authorUserId !== request.user.sub) throw new AppError('NOTE_NOT_OWNER');
    if (note.status === 'PUBLISHED') {
      return {
        data: {
          status: 'CONFIRMED',
          noteStatus: 'PUBLISHED',
          txHash: body.txHash,
          explorerUrl: app.cfg.explorerUrl(body.txHash),
        },
      };
    }
    if (note.status !== 'PENDING_ANCHOR') throw new AppError('NOTE_ALREADY_ANCHORED', 'note not anchorable');

    // mock 模式：直接发布（M1 前端联调路径）
    if (app.cfg.isMock) {
      await domain.publishNote(db, {
        noteKey: note.noteKey,
        creator: note.authorAddress,
        contentHash: note.contentHash ?? '0x' + '0'.repeat(64),
        manifestUri: note.manifestUri ?? '',
        txHash: body.txHash,
        registeredAt: new Date(),
      });
      return {
        data: {
          status: 'CONFIRMED',
          noteStatus: 'PUBLISHED',
          txHash: body.txHash,
          explorerUrl: app.cfg.explorerUrl(body.txHash),
        },
      };
    }

    const result = await verifyAnchorTx(app.svc.chain, {
      txHash: body.txHash,
      registryAddress: app.cfg.contracts.noteRegistry!,
      abiName: 'noteRegistry',
      eventName: 'NoteRegistered',
      expectedNoteKey: note.noteKey,
      expectedCreator: note.authorAddress,
      expectedContentHash: note.contentHash ?? '',
    });
    if (result.outcome === 'PENDING') {
      return { data: { status: 'SUBMITTED', txHash: body.txHash } };
    }
    if (result.outcome === 'REVERTED') {
      await db
        .update(schema.trackedTransactions)
        .set({ status: 'REVERTED', error: 'tx reverted', updatedAt: new Date() })
        .where(eq(schema.trackedTransactions.txHash, body.txHash));
      throw new AppError('TX_REVERTED');
    }
    if (result.outcome === 'INVALID') throw new AppError(result.code);

    await domain.publishNote(db, {
      noteKey: note.noteKey,
      creator: note.authorAddress,
      contentHash: note.contentHash!,
      manifestUri: note.manifestUri ?? '',
      txHash: body.txHash,
      registeredAt: new Date(),
    });
    return {
      data: {
        status: 'CONFIRMED',
        noteStatus: 'PUBLISHED',
        txHash: body.txHash,
        explorerUrl: app.cfg.explorerUrl(body.txHash),
      },
    };
  });

  // ── GET /notes/:noteId（SPEC §12.3）───────────────────────
  app.get('/notes/:noteId', async (request) => {
    const db = requireDb(app);
    const { noteId } = request.params as { noteId: string };
    const note = await getNoteById(db, noteId);
    if (!note) throw new AppError('NOTE_NOT_FOUND');
    if (note.status === 'DRAFT' || note.status === 'HIDDEN') throw new AppError('NOTE_NOT_FOUND');
    return { data: await assembleNote(db, note, app.cfg.explorerUrl.bind(app.cfg)) };
  });
}
