<script setup lang="ts">
const props = defineProps<{ start: number }>();
const shown = clampStart(props.start);
</script>

<template>
  <button class="counter">{{ shown }}</button>
</template>

<script lang="ts">
export function clampStart(n: number): number {
  return Math.max(0, Math.min(n, 10));
}
</script>
