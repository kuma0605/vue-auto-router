<template>
  <div class="not-found">
    <h1>404</h1>
    <p>页面不存在</p>
    <router-link to="/">返回首页</router-link>
  </div>
</template>

<script setup>
// 404 页面组件
</script>

<style scoped>
.not-found {
  text-align: center;
  padding: 50px;
}

h1 {
  font-size: 72px;
  margin-bottom: 20px;
  color: #e74c3c;
}

p {
  font-size: 18px;
  margin-bottom: 30px;
  color: #333;
}

a {
  color: #3498db;
  text-decoration: none;
  padding: 10px 20px;
  border: 1px solid #3498db;
  border-radius: 4px;
  transition: all 0.3s ease;
}

a:hover {
  background-color: #3498db;
  color: white;
}
</style>
