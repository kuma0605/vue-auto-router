<template>
  <div>
    <h1>404 - 页面未找到</h1>
    <p>您尝试访问的路径不存在：</p>
    <pre>{{ $route.params.all }}</pre>
    {/* 显示捕获到的路径段 */}
    <pre>{{ $route.fullPath }}</pre>
    {/* 显示完整的 URL 路径 */}
    <router-link to="/">返回首页</router-link>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
const route = useRoute()
// route.params.all 会是一个包含所有未匹配路径段的数组
// 例如，访问 /a/b/c，route.params.all 会是 ['a', 'b', 'c']
console.log('未匹配的路径段:', route.params.all)
</script>
