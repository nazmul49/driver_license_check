<script setup lang="ts">
import QRCode from 'qrcode';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

const POLL_MS = 3000;

const store = useSessionStore();
const { t } = useI18n();
const qrDataUrl = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

async function poll(): Promise<void> {
  if (stopped) return;
  const finished = await store.pollStatus();
  if (!finished && !stopped) timer = setTimeout(poll, POLL_MS);
}

onMounted(async () => {
  // Generated locally; the URL holds the token, so it must never go to a QR web service.
  qrDataUrl.value = await QRCode.toDataURL(window.location.href, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
  }).catch(() => null);
  timer = setTimeout(poll, POLL_MS);
});
onBeforeUnmount(() => {
  stopped = true;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section>
    <StepHeading>{{ t('handoff.heading') }}</StepHeading>
    <p class="mb-4">{{ t('handoff.text') }}</p>
    <img
      v-if="qrDataUrl"
      :src="qrDataUrl"
      :alt="t('handoff.qrAlt')"
      width="256"
      height="256"
      class="mx-auto mb-4 rounded-lg border border-gray-300 bg-white"
      data-testid="handoff-qr"
    />
    <p role="status" aria-live="polite" class="mb-6 text-center text-sm text-gray-700">
      {{ t('handoff.waiting') }}
    </p>
    <button type="button" class="btn-secondary" @click="store.continueOnThisDevice()">
      {{ t('handoff.thisDevice') }}
    </button>
  </section>
</template>
