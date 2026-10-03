<script setup lang="ts">
import { onMounted, ref } from 'vue';

/** Screen heading that takes focus when shown, so screen readers announce the new step. */
const heading = ref<HTMLHeadingElement | null>(null);
onMounted(() => heading.value?.focus({ preventScroll: false }));
</script>

<template>
  <h1 ref="heading" tabindex="-1" class="mb-4 text-2xl font-bold focus:outline-none">
    <slot />
  </h1>
</template>
