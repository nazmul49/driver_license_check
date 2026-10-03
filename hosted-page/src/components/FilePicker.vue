<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ label: string; primary?: boolean }>();
const emit = defineEmits<{ picked: [file: File] }>();
const input = ref<HTMLInputElement | null>(null);

function onChange(): void {
  const file = input.value?.files?.[0];
  if (file) emit('picked', file);
  if (input.value) input.value.value = '';
}
</script>

<template>
  <div>
    <input
      id="file-fallback"
      ref="input"
      type="file"
      accept="image/*"
      capture="environment"
      class="peer sr-only"
      @change="onChange"
    />
    <label
      for="file-fallback"
      :class="[
        primary ? 'btn-primary' : 'btn-secondary',
        'cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900',
      ]"
    >
      {{ label }}
    </label>
  </div>
</template>
