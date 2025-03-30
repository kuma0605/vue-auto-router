<template>
  <div class="news-detail">
    <h1>新闻详情</h1>
    <p>当前查看的新闻 ID: {{ $route.params.id }}</p>
    <router-link to="/news">返回新闻列表</router-link>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
</script>