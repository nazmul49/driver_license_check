<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import CaptureStep from '../components/CaptureStep.vue';
import DoneStep from '../components/DoneStep.vue';
import ErrorStep from '../components/ErrorStep.vue';
import HandoffStep from '../components/HandoffStep.vue';
import IntroStep from '../components/IntroStep.vue';
import ReviewStep from '../components/ReviewStep.vue';
import SubmittingStep from '../components/SubmittingStep.vue';
import { useSessionStore } from '../store/session';

const props = defineProps<{ token: string }>();
const store = useSessionStore();
const { t } = useI18n();

onMounted(() => void store.start(props.token));
watch(
  () => props.token,
  (next) => void store.start(next),
);
</script>

<template>
  <div>
    <p v-if="store.step === 'loading'" role="status" aria-live="polite" class="py-12 text-center">
      {{ t('app.loading') }}
    </p>
    <IntroStep v-else-if="store.step === 'intro'" />
    <HandoffStep v-else-if="store.step === 'handoff'" />
    <CaptureStep v-else-if="store.step === 'capture'" :key="`capture-${store.side}`" />
    <ReviewStep v-else-if="store.step === 'review'" :key="`review-${store.side}`" />
    <SubmittingStep v-else-if="store.step === 'submitting'" />
    <DoneStep v-else-if="store.step === 'done'" />
    <ErrorStep v-else-if="store.step === 'error'" :kind="store.errorKind ?? 'generic'" />
  </div>
</template>
