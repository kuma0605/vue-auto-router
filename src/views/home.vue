<route lang="json">
{
  "name": "home",
  "meta": {
    "requiresAuth": true
  }
}
</route>
<script setup>
import TheWelcome from '../components/TheWelcome.vue'
</script>

<template>
  <main>
    <TheWelcome />
  </main>
</template>
