<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ErrorKind } from '../store/session';
import { useSessionStore } from '../store/session';
import StepHeading from './StepHeading.vue';

const props = defineProps<{ kind: ErrorKind }>();
const { t } = useI18n();
const store = useSessionStore();

const text = computed(() => ({
  title: t(`error.${props.kind}Title`),
  body: t(`error.${props.kind}`),
}));
</script>

<template>
  <section :data-error="kind">
    <StepHeading>{{ text.title }}</StepHeading>
    <p role="alert" class="mb-6 text-base">{{ text.body }}</p>
    <button
      v-if="kind === 'generic' && store.token"
      type="button"
      class="btn-primary"
      @click="store.retryStart()"
    >
      {{ t('common.retry') }}
    </button>
  </section>
</template>
