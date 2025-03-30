<template>
  <div id="app">
    <header>
      <h1>Vue 自动路由示例</h1>
    </header>

    <!-- 面包屑导航 -->
    <div class="breadcrumbs" v-if="breadcrumbs.length > 1">
      <span v-for="(crumb, index) in breadcrumbs" :key="index">
        <router-link v-if="index < breadcrumbs.length - 1" :to="crumb.path">
          {{ crumb.name }}
        </router-link>
        <span v-else>{{ crumb.name }}</span>
        <span v-if="index < breadcrumbs.length - 1"> &gt; </span>
      </span>
    </div>

    <!-- 路由视图 -->
    <main>
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <suspense>
            <template #default>
              <component :is="Component" />
            </template>
            <template #fallback>
              <div class="loading">加载中...</div>
            </template>
          </suspense>
        </transition>
      </router-view>
    </main>

    <footer>
      <p>&copy; 2023 Vue 自动路由示例</p>
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { generateBreadcrumbs } from './router/guards'

const route = useRoute()

// 生成面包屑导航
const breadcrumbs = computed(() => generateBreadcrumbs(route))
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

header {
  padding: 20px 0;
  border-bottom: 1px solid #eee;
}

.breadcrumbs {
  padding: 10px 0;
  margin-bottom: 20px;
  font-size: 14px;
}

main {
  min-height: 400px;
  padding: 20px 0;
}

footer {
  padding: 20px 0;
  border-top: 1px solid #eee;
  text-align: center;
  font-size: 14px;
  color: #666;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}
</style>
