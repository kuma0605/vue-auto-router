<template>
  <router-view v-slot="{ Component, route }">
    <transition name="fade" mode="out-in">
      <keep-alive v-if="route.meta.keepAlive">
        <suspense>
          <template #default>
            <component :is="Component" />
          </template>
          <template #fallback>
            <div class="loading">
              <p>加载中...</p>
            </div>
          </template>
        </suspense>
      </keep-alive>
      <suspense v-else>
        <template #default>
          <component :is="Component" />
        </template>
        <template #fallback>
          <div class="loading">
            <p>加载中...</p>
          </div>
        </template>
      </suspense>
    </transition>
  </router-view>
</template>

<script setup>
import { onErrorCaptured, ref } from 'vue'
import { useRouter } from 'vue-router'

const error = ref(null)
const router = useRouter()

// 捕获组件加载错误
onErrorCaptured((err) => {
  error.value = err
  console.error('路由组件加载错误:', err)

  // 可以选择重定向到错误页面
  // router.push('/error')

  return false // 阻止错误继续传播
})
</script>

<style scoped>
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
