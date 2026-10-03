<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { hasCameraApi } from '../lib/device';
import { captureFrame, normalizeFile } from '../lib/image';
import { useSessionStore } from '../store/session';
import FilePicker from './FilePicker.vue';
import StepHeading from './StepHeading.vue';

type CameraState = 'starting' | 'ready' | 'denied' | 'unsupported';

const store = useSessionStore();
const { t } = useI18n();

const video = ref<HTMLVideoElement | null>(null);
const frame = ref<HTMLDivElement | null>(null);
const camera = ref<CameraState>(hasCameraApi() ? 'starting' : 'unsupported');
const capturing = ref(false);
const captureError = ref(false);
let stream: MediaStream | null = null;
let disposed = false;

const heading = computed(() =>
  store.side === 'front' ? t('capture.frontHeading') : t('capture.backHeading'),
);
const stepNumber = computed(() => (store.side === 'front' ? 2 : 3));
const showCamera = computed(() => camera.value === 'starting' || camera.value === 'ready');

function stopCamera(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

async function startCamera(): Promise<void> {
  if (!hasCameraApi()) {
    camera.value = 'unsupported';
    return;
  }
  camera.value = 'starting';
  captureError.value = false;
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3000 },
        height: { ideal: 2000 },
      },
    });
    if (disposed) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = media;
    const el = video.value;
    if (!el) return;
    el.srcObject = media;
    await el.play().catch(() => undefined);
    camera.value = 'ready';
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    camera.value =
      name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported';
  }
}

async function takePhoto(): Promise<void> {
  if (!video.value || !frame.value || capturing.value) return;
  capturing.value = true;
  captureError.value = false;
  try {
    const image = await captureFrame(video.value, frame.value);
    stopCamera();
    store.captured(image);
  } catch {
    captureError.value = true;
  } finally {
    capturing.value = false;
  }
}

async function onFile(file: File): Promise<void> {
  stopCamera();
  store.captured(await normalizeFile(file));
}

onMounted(() => {
  if (camera.value === 'starting') void startCamera();
});
onBeforeUnmount(() => {
  disposed = true;
  stopCamera();
});
</script>

<template>
  <section :data-side="store.side">
    <p class="mb-1 text-sm text-gray-700">
      {{ t('app.stepOf', { current: stepNumber, total: 4 }) }}
    </p>
    <StepHeading>{{ heading }}</StepHeading>

    <div v-if="showCamera">
      <p class="mb-3">{{ t('capture.instructions') }}</p>
      <div class="relative mb-3 aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
        <video
          ref="video"
          class="absolute inset-0 size-full object-cover"
          autoplay
          muted
          playsinline
          :aria-label="t('capture.cameraLabel')"
        ></video>
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <div
            ref="frame"
            class="aspect-[85.6/53.98] w-[86%] rounded-xl border-4 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          ></div>
        </div>
      </div>
      <p role="status" aria-live="polite" class="mb-3 text-sm text-gray-700">
        {{ camera === 'ready' ? t('capture.cameraReady') : t('capture.cameraStarting') }}
      </p>
      <p v-if="captureError" role="alert" class="mb-3 text-red-800">
        {{ t('capture.captureFailed') }}
      </p>
      <button
        type="button"
        class="btn-primary mb-3"
        :disabled="camera !== 'ready' || capturing"
        @click="takePhoto"
      >
        {{ t('capture.takePhoto') }}
      </button>
      <FilePicker :label="t('capture.choosePhoto')" class="mb-6" @picked="onFile" />
    </div>

    <div v-else class="mb-6">
      <div role="alert" class="mb-4 rounded-lg border border-amber-700 bg-amber-50 p-4">
        <h2 v-if="camera === 'denied'" class="mb-1 font-semibold">
          {{ t('capture.cameraDeniedTitle') }}
        </h2>
        <p>
          {{ camera === 'denied' ? t('capture.cameraDenied') : t('capture.cameraUnsupported') }}
        </p>
      </div>
      <FilePicker :label="t('capture.choosePhoto')" primary class="mb-3" @picked="onFile" />
      <button v-if="camera === 'denied'" type="button" class="btn-secondary" @click="startCamera">
        {{ t('capture.tryCameraAgain') }}
      </button>
    </div>

    <h2 class="mb-2 text-lg font-semibold">{{ t('capture.tipsTitle') }}</h2>
    <ul class="list-disc space-y-1 pl-6">
      <li>{{ t('capture.tipFlat') }}</li>
      <li>{{ t('capture.tipGlare') }}</li>
      <li>{{ t('capture.tipCorners') }}</li>
    </ul>
  </section>
</template>
