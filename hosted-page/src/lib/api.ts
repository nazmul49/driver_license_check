import type {
  ErrorBody,
  ErrorCode,
  HostedSessionInfo,
  HostedStatusResponse,
  HostedSubmitResponse,
  ImageSide,
} from '@dlc/shared';

const BASE = '/hosted/api';

/** Error from the hosted API, or a network failure (code NETWORK_ERROR, status 0). */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';
  readonly status: number;
  readonly requestId: string | null;

  constructor(
    code: ApiError['code'],
    status: number,
    message: string,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error: unknown }).error;
  return (
    typeof err === 'object' && err !== null && typeof (err as { code: unknown }).code === 'string'
  );
}

function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) {
    return new ApiError(body.error.code, status, body.error.message, body.error.request_id);
  }
  return new ApiError('UNKNOWN', status, `Request failed with status ${status}`);
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'Network request failed');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}

export interface UploadResult {
  uploaded: { front: boolean; back: boolean };
}

/**
 * Multipart upload with progress. Uses XMLHttpRequest because fetch has no upload progress
 * events. `onProgress` receives a fraction between 0 and 1.
 */
function uploadImage(
  side: ImageSide,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/session/images/${side}`);
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(data as UploadResult);
      } else {
        reject(toApiError(xhr.status, data));
      }
    });
    xhr.addEventListener('error', () =>
      reject(new ApiError('NETWORK_ERROR', 0, 'Network request failed')),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError('NETWORK_ERROR', 0, 'Upload was aborted')),
    );
    const form = new FormData();
    form.append('file', file, `${side}.jpg`);
    xhr.send(form);
  });
}

export const api = {
  open: (token: string) => request<HostedSessionInfo>('POST', '/session/open', { token }),
  info: () => request<HostedSessionInfo>('GET', '/session'),
  consent: (consentVersion: string) =>
    request<void>('POST', '/session/consent', { consent_version: consentVersion, accepted: true }),
  uploadImage,
  submit: () => request<HostedSubmitResponse>('POST', '/session/submit'),
  status: () => request<HostedStatusResponse>('GET', '/session/status'),
};
