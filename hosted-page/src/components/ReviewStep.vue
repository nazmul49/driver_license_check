<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { analyzeImage, type QualityReport } from '../lib/image';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

const store = useSessionStore();
const { t } = useI18n();

const report = ref<QualityReport | null>(null);
const analyzing = ref(true);

const percent = computed(() => Math.round(store.uploadProgress * 100));
const stepNumber = computed(() => (store.side === 'front' ? 2 : 3));
const statusText = computed(() => {
  if (store.uploading) return t('review.uploading', { percent: percent.value });
  if (analyzing.value) return t('review.checking');
  return '';
});

onMounted(async () => {
  const image = store.currentImage;
  if (image) report.value = await analyzeImage(image).catch(() => null);
  analyzing.value = false;
});
</script>

<template>
  <section v-if="store.currentImage" :data-side="store.side">
    <p class="mb-1 text-sm text-gray-700">
      {{ t('app.stepOf', { current: stepNumber, total: 4 }) }}
    </p>
    <StepHeading>{{ t('review.heading') }}</StepHeading>

    <img
      :src="store.currentImage.url"
      :alt="t('review.alt', { side: t(`side.${store.side}`) })"
      class="mb-4 w-full rounded-lg border border-gray-300 bg-white object-contain"
    />

    <div
      v-if="report && report.warnings.length"
      class="mb-4 rounded-lg border border-amber-700 bg-amber-50 p-4"
      data-testid="quality-warnings"
    >
      <p class="mb-1 font-semibold">{{ t('review.warningsTitle') }}</p>
      <ul class="list-disc pl-6">
        <li v-for="w in report.warnings" :key="w">{{ t(`warning.${w}`) }}</li>
      </ul>
    </div>
    <p v-else-if="report" class="mb-4">{{ t('review.looksGood') }}</p>

    <p role="status" aria-live="polite" class="mb-2 min-h-6 text-sm text-gray-700">
      {{ statusText }}
    </p>
    <progress
      v-if="store.uploading"
      class="mb-4 h-3 w-full accent-primary"
      max="100"
      :value="percent"
      :aria-label="t('review.uploadingLabel')"
    ></progress>

    <div
      v-if="store.inlineError"
      role="alert"
      class="mb-4 rounded-lg border border-red-800 bg-red-50 p-4"
    >
      <p class="font-semibold">{{ t('upload.failedTitle') }}</p>
      <p>{{ t(store.inlineError) }}</p>
    </div>

    <div class="flex flex-col gap-3">
      <button
        type="button"
        class="btn-primary"
        :disabled="store.uploading"
        @click="store.uploadCurrent()"
      >
        {{ store.inlineError ? t('common.retry') : t('review.usePhoto') }}
      </button>
      <button
        type="button"
        class="btn-secondary"
        :disabled="store.uploading"
        @click="store.retake()"
      >
        {{ t('review.retake') }}
      </button>
    </div>
  </section>
</template>
