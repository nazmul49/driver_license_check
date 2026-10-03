<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

const store = useSessionStore();
const { t } = useI18n();
</script>

<template>
  <section>
    <p class="mb-1 text-sm text-gray-700">{{ t('app.stepOf', { current: 4, total: 4 }) }}</p>
    <StepHeading>{{ t('submit.heading') }}</StepHeading>
    <p v-if="!store.inlineError" role="status" aria-live="polite">{{ t('submit.text') }}</p>
    <template v-else>
      <p role="alert" class="mb-4 rounded-lg border border-red-800 bg-red-50 p-4">
        {{ t(store.inlineError) }}
      </p>
      <button type="button" class="btn-primary" @click="store.submit()">
        {{ t('common.retry') }}
      </button>
    </template>
  </section>
</template>
