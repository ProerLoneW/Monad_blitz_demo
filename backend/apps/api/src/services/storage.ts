import { createHash, createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '@proofnote/chain-config';

/**
 * 对象存储双驱动（后端开发文档 §4.4 / §2）：
 * - local：本地磁盘（零依赖开发模式），presign = HMAC 签名的自有上传 URL
 * - s3：S3 兼容（R2/S3/MinIO），标准 presigned PUT
 */
export interface PresignResult {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  sha256: string | null;
}

export class StorageService {
  readonly driver: 'local' | 's3';
  private localRoot: string | null = null;
  private s3: import('@aws-sdk/client-s3').S3Client | null = null;

  constructor(private env: Env) {
    this.driver = env.STORAGE_DRIVER;
    if (this.driver === 'local') {
      this.localRoot = resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    }
  }

  // ── 公共接口 ──────────────────────────────────────────────

  async presignPut(key: string, contentType: string): Promise<PresignResult> {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    if (this.driver === 'local') {
      const token = this.signLocalToken({ key, contentType, exp: expiresAt.getTime() });
      return {
        uploadUrl: `${this.env.API_BASE_URL}/api/v1/uploads/direct/${token}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt,
      };
    }
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = await this.s3Client();
    const cmd = new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ContentType: contentType });
    const url = await getSignedUrl(client, cmd, { expiresIn: 900 });
    return { uploadUrl: url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt };
  }

  /** 服务端直写（manifest 等生成内容） */
  async putObject(key: string, contentType: string, body: Buffer): Promise<void> {
    if (this.driver === 'local') {
      const p = this.localPath(key);
      await mkdirSync(dirname(p), { recursive: true });
      await writeFile(p, body);
      return;
    }
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.s3Client();
    await client.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  }

  /** HEAD + sha256（complete 校验用；maxShaBytes 以上跳过哈希计算，P0 权衡） */
  async headAndHash(key: string, maxShaBytes = 64 * 1024 * 1024): Promise<ObjectInfo | null> {
    if (this.driver === 'local') {
      const p = this.localPath(key);
      if (!existsSync(p)) return null;
      const st = await stat(p);
      const sha = st.size <= maxShaBytes ? await sha256File(p) : null;
      return { size: st.size, sha256: sha };
    }
    const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.s3Client();
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      const size = head.ContentLength ?? 0;
      let sha: string | null = null;
      if (size <= maxShaBytes) {
        const obj = await client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
        if (obj.Body) {
          const hash = createHash('sha256');
          await pipeHash(obj.Body as Readable, hash);
          sha = hash.digest('hex');
        }
      }
      return { size, sha256: sha };
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return `${this.env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }

  // ── local 驱动专属 ────────────────────────────────────────

  localRootDir(): string {
    if (!this.localRoot) throw new Error('storage driver is not local');
    return this.localRoot;
  }

  signLocalToken(payload: { key: string; contentType: string; exp: number }): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.env.JWT_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verifyLocalToken(token: string): { key: string; contentType: string; exp: number } | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.env.JWT_SECRET).update(body).digest('base64url');
    if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  localPath(key: string): string {
    const root = this.localRootDir();
    const p = normalize(join(root, key));
    if (p !== root && !p.startsWith(root + '/')) throw new Error('path traversal detected');
    return p;
  }

  writeLocalStream(key: string): import('node:fs').WriteStream {
    const p = this.localPath(key);
    mkdirSync(dirname(p), { recursive: true });
    return createWriteStream(p);
  }

  // ── s3 ────────────────────────────────────────────────────

  private async s3Client() {
    if (!this.s3) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.s3 = new S3Client({
        region: this.env.S3_REGION,
        ...(this.env.S3_ENDPOINT ? { endpoint: this.env.S3_ENDPOINT } : {}),
        credentials: {
          accessKeyId: this.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY ?? '',
        },
        forcePathStyle: Boolean(this.env.S3_ENDPOINT),
      });
    }
    return this.s3;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return nodeTimingSafeEqual(ba, bb);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeHash(createReadStream(path), hash);
  return hash.digest('hex');
}

async function pipeHash(stream: Readable, hash: import('node:crypto').Hash): Promise<void> {
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
}

export function sanitizeFilename(name: string): string {
  const base = name.split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned || `file_${randomBytes(4).toString('hex')}`;
}
