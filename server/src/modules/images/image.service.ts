import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Config } from '../../config/index.js';
import { createHash } from 'node:crypto';
import type { ImageSide } from '@dlc/shared';
import sharp from 'sharp';
import type { Clock } from '../../lib/clock.js';
import type { Encryptor } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { ImageKind, ImageRepository, SessionImage } from './image.repository.js';
import type { ImageStore } from './image-store.js';

export type DetectedMime = 'image/jpeg' | 'image/png' | 'image/heic';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Identify the format from magic bytes, ignoring any client-declared mime type (SPEC 10.5). */
export function sniffImageType(buf: Buffer): DetectedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    if (HEIC_BRANDS.has(buf.subarray(8, 12).toString('latin1'))) return 'image/heic';
  }
  return null;
}

@injectable()
export class ImageService {
  private readonly repo: ImageRepository;
  private readonly store: ImageStore;
  private readonly encryptor: Encryptor;
  private readonly clock: Clock;
  private readonly maxPixels: number;

  constructor(
    @inject(TOKENS.imageRepository) imageRepository: ImageRepository,
    @inject(TOKENS.imageStore) imageStore: ImageStore,
    @inject(TOKENS.encryptor) encryptor: Encryptor,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.config) config: Config,
  ) {
    this.repo = imageRepository;
    this.store = imageStore;
    this.encryptor = encryptor;
    this.clock = clock;
    this.maxPixels = config.UPLOAD_MAX_PIXELS;
  }

  /**
   * Validate an upload, decode it with sharp, apply EXIF orientation and re-encode as JPEG.
   * Re-encoding drops metadata and anything embedded in the file (SPEC 12). The pixel limit
   * guards against decompression bombs.
   */
  async normalizeUpload(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
    const type = sniffImageType(buf);
    if (!type)
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG and HEIC images are accepted.');
    try {
      const { data, info } = await sharp(buf, { limitInputPixels: this.maxPixels, failOn: 'error' })
        .rotate()
        .jpeg({ quality: 92, mozjpeg: false })
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/pixel limit/i.test(msg))
        throw new AppError('PAYLOAD_TOO_LARGE', 'Image has too many pixels.');
      if (type === 'image/heic') {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          'This HEIC image could not be decoded. Please use JPEG or PNG.',
        );
      }
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The image could not be decoded.');
    }
  }

  async save(
    sessionId: string,
    side: ImageSide,
    kind: ImageKind,
    img: { data: Buffer; width: number; height: number; mime: string; phash?: string | null },
  ): Promise<void> {
    const existing = await this.repo.find(sessionId, side, kind);
    const { envelope, keyId } = this.encryptor.encrypt(img.data);
    const storageKey = `${sessionId}/${side}-${kind}-${newId()}.bin`;
    await this.store.put(storageKey, envelope);
    await this.repo.upsert({
      id: existing?.id ?? newId(),
      session_id: sessionId,
      side,
      kind,
      storage_key: storageKey,
      mime: img.mime,
      width: img.width,
      height: img.height,
      bytes: img.data.length,
      sha256: createHash('sha256').update(img.data).digest('hex'),
      phash: img.phash ?? null,
      enc_key_id: keyId,
      created_at: this.clock.now(),
    });
    if (existing) await this.store.delete(existing.storage_key);
  }

  async load(
    sessionId: string,
    side: ImageSide,
    kind: ImageKind,
  ): Promise<{ meta: SessionImage; data: Buffer } | null> {
    const meta = await this.repo.find(sessionId, side, kind);
    if (!meta) return null;
    const data = this.encryptor.decrypt(await this.store.get(meta.storage_key));
    return { meta, data };
  }

  async uploadedSides(sessionId: string): Promise<{ front: boolean; back: boolean }> {
    const imgs = await this.repo.listActive(sessionId);
    const has = (side: ImageSide) => imgs.some((i) => i.side === side && i.kind === 'original');
    return { front: has('front'), back: has('back') };
  }

  /** Delete blobs and mark rows deleted. kind undefined deletes every image of the session. */
  async deleteImages(sessionId: string, kind?: ImageKind): Promise<number> {
    const imgs = (await this.repo.listActive(sessionId)).filter((i) => !kind || i.kind === kind);
    for (const img of imgs) await this.store.delete(img.storage_key);
    await this.repo.markDeleted(
      imgs.map((i) => i.id),
      this.clock.now(),
    );
    return imgs.length;
  }
}
