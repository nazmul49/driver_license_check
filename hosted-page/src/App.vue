<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from './store/session';

const store = useSessionStore();
const { t } = useI18n();

/** The CSP only allows same-origin images, so a logo on another origin is not rendered. */
const logoUrl = computed(() => {
  const raw = store.info?.integrator.logo_url;
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
});
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-4 sm:py-8">
    <header v-if="store.info" class="mb-6 flex items-center gap-3">
      <img
        v-if="logoUrl"
        :src="logoUrl"
        :alt="t('app.logoAlt', { name: store.integratorName })"
        class="h-10 w-auto max-w-40 object-contain"
      />
      <p class="text-lg font-semibold">{{ store.integratorName }}</p>
    </header>
    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
