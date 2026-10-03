import { randomBytes } from 'node:crypto';
import { monotonicFactory } from 'ulid';

// Monotonic so ids created in the same millisecond still sort in creation order.
const ulid = monotonicFactory();

export const newId = (): string => ulid();
export const newSessionId = (): string => `ses_${ulid()}`;
export const newRequestId = (): string => `req_${ulid()}`;
export const newEventId = (): string => `evt_${ulid()}`;
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
