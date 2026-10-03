<script setup lang="ts">
import { onMounted } from 'vue';
import ErrorStep from '../components/ErrorStep.vue';
import { setLocale } from '../i18n';
import { resolveLocale } from '../lib/locale';

onMounted(() => setLocale(resolveLocale(null)));
</script>

<template>
  <ErrorStep kind="invalid" />
</template>
