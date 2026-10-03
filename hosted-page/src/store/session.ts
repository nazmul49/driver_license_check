import type { HostedSessionInfo, ImageSide } from '@dlc/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { setLocale } from '../i18n';
import { ApiError, api } from '../lib/api';
import { hasRearCamera, isDesktopDevice } from '../lib/device';
import type { CapturedImage } from '../lib/image';
import { resolveLocale } from '../lib/locale';
import { applyPrimaryColor } from '../lib/theme';

export type Step =
  'loading' | 'intro' | 'handoff' | 'capture' | 'review' | 'submitting' | 'done' | 'error';

export type ErrorKind = 'invalid' | 'expired' | 'used' | 'closed' | 'generic';

/** i18n keys for recoverable upload or submit failures shown inline with a retry. */
export type InlineError = 'upload.failed' | 'upload.tooLarge' | 'upload.badType' | 'submit.failed';

const SIDES: ImageSide[] = ['front', 'back'];

function isSafeRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Single store for the hosted flow: session info from the server, the current step, captured
 * images and every hosted API call. Components only read state and call actions.
 */
export const useSessionStore = defineStore('session', () => {
  const token = ref<string | null>(null);
  const info = ref<HostedSessionInfo | null>(null);
  const step = ref<Step>('loading');
  const side = ref<ImageSide>('front');
  const errorKind = ref<ErrorKind | null>(null);
  const images = ref<Record<ImageSide, CapturedImage | null>>({ front: null, back: null });
  const uploading = ref(false);
  const uploadProgress = ref(0);
  const inlineError = ref<InlineError | null>(null);
  const redirectUrl = ref<string | null>(null);
  const handoffDismissed = ref(false);
  const busy = ref(false);

  const integratorName = computed(() => info.value?.integrator.display_name ?? '');
  const currentImage = computed(() => images.value[side.value]);

  function fail(kind: ErrorKind): void {
    errorKind.value = kind;
    step.value = 'error';
  }

  /** Maps errors that end the flow to an error screen. Returns false when the error is recoverable. */
  function handleFatal(err: unknown): boolean {
    if (!(err instanceof ApiError)) return false;
    switch (err.code) {
      case 'SESSION_NOT_FOUND':
      case 'VALIDATION_ERROR':
        if (step.value === 'loading') {
          fail('invalid');
          return true;
        }
        return false;
      case 'SESSION_EXPIRED':
      case 'UNAUTHORIZED':
        fail('expired');
        return true;
      case 'LINK_ALREADY_USED':
        fail('used');
        return true;
      case 'INVALID_STATE':
        fail('closed');
        return true;
      default:
        return false;
    }
  }

  function applyInfo(next: HostedSessionInfo): void {
    info.value = next;
    setLocale(resolveLocale(next.locale));
    applyPrimaryColor(next.integrator.primary_color);
  }

  function setImage(which: ImageSide, image: CapturedImage | null): void {
    const previous = images.value[which];
    if (previous && previous !== image) URL.revokeObjectURL(previous.url);
    images.value = { ...images.value, [which]: image };
  }

  function finish(url: string): void {
    redirectUrl.value = isSafeRedirect(url) ? url : null;
    step.value = 'done';
  }

  async function start(newToken: string): Promise<void> {
    token.value = newToken;
    step.value = 'loading';
    errorKind.value = null;
    setLocale(resolveLocale(null));
    try {
      applyInfo(await api.open(newToken));
    } catch (err) {
      if (!handleFatal(err)) fail('generic');
      return;
    }
    const current = info.value!;
    if (current.status !== 'in_progress') {
      // Reopened with the session cookie after submitting: send the user back to the integrator.
      try {
        const status = await api.status();
        if (status.redirect_url) finish(status.redirect_url);
        else fail('closed');
      } catch (err) {
        if (!handleFatal(err)) fail('generic');
      }
      return;
    }
    if (!current.consent.accepted) {
      step.value = 'intro';
      return;
    }
    await proceed();
  }

  async function retryStart(): Promise<void> {
    if (token.value) await start(token.value);
  }

  async function acceptConsent(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      // The server states the consent text version it requires (shared CONSENT_VERSION). Taking it
      // from the session info keeps zod and the rest of @dlc/shared out of the browser bundle.
      await api.consent(info.value!.consent.required_version);
      if (info.value) info.value.consent.accepted = true;
      await proceed();
    } catch (err) {
      if (!handleFatal(err)) fail('generic');
    } finally {
      busy.value = false;
    }
  }

  async function shouldOfferHandoff(): Promise<boolean> {
    if (!info.value?.desktop_handoff || handoffDismissed.value) return false;
    if (!isDesktopDevice()) return false;
    return !(await hasRearCamera());
  }

  /** Moves to the first side that still needs a photo, or submits when both are uploaded. */
  async function proceed(): Promise<void> {
    const uploaded = info.value?.uploaded ?? { front: false, back: false };
    const missing = SIDES.find((s) => !uploaded[s]);
    if (!missing) {
      await submit();
      return;
    }
    side.value = missing;
    inlineError.value = null;
    step.value = (await shouldOfferHandoff()) ? 'handoff' : 'capture';
  }

  function continueOnThisDevice(): void {
    handoffDismissed.value = true;
    step.value = 'capture';
  }

  function captured(image: CapturedImage): void {
    setImage(side.value, image);
    inlineError.value = null;
    uploadProgress.value = 0;
    step.value = 'review';
  }

  function retake(): void {
    setImage(side.value, null);
    inlineError.value = null;
    step.value = 'capture';
  }

  async function uploadCurrent(): Promise<void> {
    const image = currentImage.value;
    if (!image || uploading.value) return;
    uploading.value = true;
    uploadProgress.value = 0;
    inlineError.value = null;
    try {
      const res = await api.uploadImage(side.value, image.blob, (f) => {
        uploadProgress.value = f;
      });
      if (info.value) info.value.uploaded = res.uploaded;
      setImage(side.value, null);
      await proceed();
    } catch (err) {
      if (handleFatal(err)) return;
      const code = err instanceof ApiError ? err.code : null;
      inlineError.value =
        code === 'PAYLOAD_TOO_LARGE'
          ? 'upload.tooLarge'
          : code === 'UNSUPPORTED_MEDIA_TYPE'
            ? 'upload.badType'
            : 'upload.failed';
    } finally {
      uploading.value = false;
    }
  }

  async function submit(): Promise<void> {
    step.value = 'submitting';
    inlineError.value = null;
    try {
      const res = await api.submit();
      finish(res.redirect_url);
    } catch (err) {
      if (!handleFatal(err)) inlineError.value = 'submit.failed';
    }
  }

  /** Desktop handoff poll: true once the phone has finished and we moved on. */
  async function pollStatus(): Promise<boolean> {
    try {
      const status = await api.status();
      if (status.redirect_url) {
        finish(status.redirect_url);
        return true;
      }
      if (status.status === 'expired' || status.status === 'cancelled') {
        fail('expired');
        return true;
      }
    } catch (err) {
      if (handleFatal(err)) return true;
      // Transient network errors: keep polling.
    }
    return false;
  }

  return {
    token,
    info,
    step,
    side,
    errorKind,
    images,
    uploading,
    uploadProgress,
    inlineError,
    redirectUrl,
    busy,
    integratorName,
    currentImage,
    start,
    retryStart,
    acceptConsent,
    continueOnThisDevice,
    captured,
    retake,
    uploadCurrent,
    submit,
    pollStatus,
  };
});
