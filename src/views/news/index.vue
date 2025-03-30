<template>
  <div class="news-list">
    <h1>新闻列表</h1>
    <ul>
      <li v-for="id in 5" :key="id">
        <router-link :to="`/news/detail/${id}`">新闻 {{ id }}</router-link>
      </li>
    </ul>
  </div>
</template>