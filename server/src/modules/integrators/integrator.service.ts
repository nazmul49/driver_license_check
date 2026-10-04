import { inject, injectable } from 'inversify';
import { TOKENS } from '../../di/tokens.js';
import type { Config } from '../../config/index.js';
import { randomBytes } from 'node:crypto';
import type { Clock } from '../../lib/clock.js';
import { hmacHex, safeEqual, type Encryptor } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import type { IntegratorRepository, NewIntegrator } from './integrator.repository.js';
import type { Integrator } from './integrator.types.js';

/**
 * API key format: dlc_<mode>_<43 chars base64url of 32 random bytes>.
 * The stored "prefix" is the first 8 characters of the random part (the literal "dlc_live" /
 * "dlc_test" would not identify anything). Keys are stored as HMAC-SHA256(pepper, key); the
 * random part has 256 bits of entropy, so a fast keyed hash is sufficient (SPEC 5.1).
 */
const KEY_PATTERN = /^dlc_(live|test)_([A-Za-z0-9_-]{43})$/;

export interface AuthenticatedKey {
  integrator: Integrator;
  keyId: string;
  mode: 'live' | 'test';
}

@injectable()
export class IntegratorService {
  private readonly repo: IntegratorRepository;
  private readonly encryptor: Encryptor;
  private readonly pepper: string;
  private readonly clock: Clock;

  constructor(
    @inject(TOKENS.integratorRepository) integratorRepository: IntegratorRepository,
    @inject(TOKENS.encryptor) encryptor: Encryptor,
    @inject(TOKENS.clock) clock: Clock,
    @inject(TOKENS.config) config: Config,
  ) {
    this.repo = integratorRepository;
    this.encryptor = encryptor;
    this.clock = clock;
    this.pepper = config.API_KEY_PEPPER;
  }

  private hashKey(key: string): string {
    return hmacHex(this.pepper, key);
  }

  async authenticate(rawKey: string): Promise<AuthenticatedKey | null> {
    const match = KEY_PATTERN.exec(rawKey);
    if (!match) return null;
    const prefix = match[2]!.slice(0, 8);
    const candidates = await this.repo.findKeysByPrefix(prefix);
    const hash = this.hashKey(rawKey);
    const key = candidates.find((c) => safeEqual(c.key_hash, hash));
    if (!key) return null;
    const integrator = await this.repo.findById(key.integrator_id);
    if (!integrator || integrator.disabled_at) return null;
    // Fire and forget: last_used_at is informational.
    void this.repo.touchKey(key.id, this.clock.now()).catch(() => undefined);
    return { integrator, keyId: key.id, mode: key.mode };
  }

  async createIntegrator(
    input: Omit<NewIntegrator, 'id' | 'webhook_secret_enc'>,
  ): Promise<{ integrator: Integrator; webhookSecret: string }> {
    const webhookSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    const id = newId();
    await this.repo.insert(
      {
        ...input,
        id,
        webhook_secret_enc: this.encryptor.encrypt(Buffer.from(webhookSecret)).envelope,
      },
      this.clock.now(),
    );
    return { integrator: (await this.repo.findById(id))!, webhookSecret };
  }

  async createApiKey(
    integratorId: string,
    mode: 'live' | 'test',
  ): Promise<{ id: string; key: string }> {
    const random = randomBytes(32).toString('base64url');
    const key = `dlc_${mode}_${random}`;
    const id = newId();
    await this.repo.insertKey(
      {
        id,
        integrator_id: integratorId,
        prefix: random.slice(0, 8),
        key_hash: this.hashKey(key),
        mode,
      },
      this.clock.now(),
    );
    return { id, key };
  }

  revokeApiKey(keyId: string): Promise<number> {
    return this.repo.revokeKey(keyId, this.clock.now());
  }

  async rotateWebhookSecret(integratorId: string): Promise<string> {
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    await this.repo.update(
      integratorId,
      { webhook_secret_enc: this.encryptor.encrypt(Buffer.from(secret)).envelope },
      this.clock.now(),
    );
    return secret;
  }

  webhookSecret(integrator: Integrator): string | null {
    return integrator.webhook_secret_enc
      ? this.encryptor.decrypt(integrator.webhook_secret_enc).toString('utf8')
      : null;
  }
}
