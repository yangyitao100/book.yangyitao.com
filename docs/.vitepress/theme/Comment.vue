<!--
  Giscus 评论组件

  使用前需要：
  1. 前往 https://giscus.app 配置你的仓库
  2. 将下方 REPO_ID_PLACEHOLDER 替换为你的 repoId
  3. 将下方 CATEGORY_ID_PLACEHOLDER 替换为你的 categoryId
  4. 确保仓库已启用 GitHub Discussions 并创建了 Announcements 分类
-->
<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useData, useRoute } from 'vitepress'
import Giscus from '@giscus/vue'

const { isDark } = useData()
const route = useRoute()

const theme = ref(isDark.value ? 'dark' : 'light')

watch(isDark, (val) => {
  theme.value = val ? 'dark' : 'light'
})

// Force re-render on route change
const key = ref(0)
watch(() => route.path, () => {
  nextTick(() => {
    key.value++
  })
})
</script>

<template>
  <div class="comment-section">
    <Giscus
      :key="key"
      repo="yangyitao100/book.yangyitao.com"
      repo-id="REPO_ID_PLACEHOLDER"
      category="Announcements"
      category-id="CATEGORY_ID_PLACEHOLDER"
      mapping="pathname"
      strict="0"
      reactions-enabled="1"
      emit-metadata="0"
      input-position="top"
      :theme="theme"
      lang="zh-CN"
      crossorigin="anonymous"
      loading="lazy"
    />
  </div>
</template>

<style scoped>
.comment-section {
  max-width: 784px;
  margin: 48px auto 0;
  padding: 32px 24px 0;
  border-top: 1px solid var(--vp-c-divider);
}
</style>
