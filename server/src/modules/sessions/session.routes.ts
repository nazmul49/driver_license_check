import {
  CreateSessionRequestSchema,
  ImageSideParamSchema,
  ListSessionsQuerySchema,
  SessionIdParamSchema,
} from '@dlc/shared';
import express, { Router, type Request } from 'express';
import { AppError } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ImageService } from '../images/image.service.js';
import type { SessionService } from './session.service.js';

export function sessionRouter(d: {
  sessions: SessionService;
  images: ImageService;
  audit: AuditService;
}): Router {
  const router = Router();
  router.use(express.json({ limit: '16kb' }));

  const audit = (req: Request, action: string, sessionId: string) =>
    d.audit.record({
      actorType: 'integrator',
      actorId: req.auth!.integrator.id,
      action,
      sessionId,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: req.requestId,
    });

  router.post('/', async (req, res) => {
    if (!req.is('application/json'))
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.');
    const input = CreateSessionRequestSchema.parse(req.body);
    const created = await d.sessions.create(req.auth!.integrator, input);
    await audit(req, 'session.create', created.id);
    res.status(201).json(created);
  });

  router.get('/', async (req, res) => {
    const q = ListSessionsQuerySchema.parse(req.query);
    res.json(await d.sessions.list(req.auth!.integrator, q));
  });

  router.get('/:id', async (req, res) => {
    const { id } = SessionIdParamSchema.parse(req.params);
    const dto = await d.sessions.getDto(req.auth!.integrator, id);
    if (dto.result) await audit(req, 'session.read_result', id);
    res.json(dto);
  });

  router.get('/:id/images/:side', async (req, res) => {
    const { id } = SessionIdParamSchema.parse({ id: req.params.id });
    const { side } = ImageSideParamSchema.parse({ side: req.params.side });
    const integrator = req.auth!.integrator;
    if (!integrator.allow_image_download)
      throw new AppError('FORBIDDEN', 'Image download is not enabled.');
    const session = await d.sessions.getForIntegrator(integrator, id);
    const img = session.deleted_at ? null : await d.images.load(session.id, side, 'processed');
    if (!img) throw new AppError('NOT_FOUND', 'Image not available.');
    await audit(req, `session.read_image.${side}`, id);
    res.setHeader('Content-Type', img.meta.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${id}-${side}.jpg"`);
    res.send(img.data);
  });

  router.delete('/:id', async (req, res) => {
    const { id } = SessionIdParamSchema.parse(req.params);
    await d.sessions.delete(req.auth!.integrator, id);
    await audit(req, 'session.delete', id);
    res.status(204).end();
  });

  return router;
}
