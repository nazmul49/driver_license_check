<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

/** Never shows the verification result: the integrator decides what to show (SPEC 10.2). */
const REDIRECT_DELAY_MS = 3000;

const store = useSessionStore();
const { t } = useI18n();
let timer: ReturnType<typeof setTimeout> | null = null;

function goBack(): void {
  if (store.redirectUrl) window.location.assign(store.redirectUrl);
}

onMounted(() => {
  if (store.redirectUrl) timer = setTimeout(goBack, REDIRECT_DELAY_MS);
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section>
    <StepHeading>{{ t('done.heading') }}</StepHeading>
    <div role="status" aria-live="polite" class="mb-6">
      <p class="mb-2 text-base">{{ t('done.text', { name: store.integratorName }) }}</p>
      <p v-if="store.redirectUrl" class="text-sm text-gray-700">{{ t('done.redirecting') }}</p>
    </div>
    <button v-if="store.redirectUrl" type="button" class="btn-primary" @click="goBack">
      {{ t('done.return', { name: store.integratorName }) }}
    </button>
  </section>
</template>
