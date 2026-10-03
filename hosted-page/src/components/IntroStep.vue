<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

const store = useSessionStore();
const { t } = useI18n();
const agreed = ref(false);

function onSubmit(): void {
  if (agreed.value) void store.acceptConsent();
}
</script>

<template>
  <section>
    <StepHeading>{{ t('intro.heading') }}</StepHeading>
    <p class="mb-6 text-base">{{ t('intro.lead', { name: store.integratorName }) }}</p>

    <h2 class="mb-2 text-lg font-semibold">{{ t('intro.whatHappens') }}</h2>
    <ol class="mb-6 list-decimal space-y-1 pl-6">
      <li>{{ t('intro.step1') }}</li>
      <li>{{ t('intro.step2') }}</li>
      <li>{{ t('intro.step3', { name: store.integratorName }) }}</li>
    </ol>

    <h2 class="mb-2 text-lg font-semibold">{{ t('intro.privacyTitle') }}</h2>
    <p id="privacy-notice" class="mb-6 text-sm text-gray-700">{{ t('intro.privacy') }}</p>

    <form novalidate @submit.prevent="onSubmit">
      <div class="mb-6 flex items-start gap-3 rounded-lg border border-gray-300 bg-white p-4">
        <input
          id="consent"
          v-model="agreed"
          type="checkbox"
          class="mt-0.5 size-6 shrink-0 accent-primary"
          aria-describedby="privacy-notice"
        />
        <label for="consent" class="text-base">{{ t('intro.consent') }}</label>
      </div>
      <button type="submit" class="btn-primary" :disabled="!agreed || store.busy">
        {{ t('common.continue') }}
      </button>
    </form>
  </section>
</template>
