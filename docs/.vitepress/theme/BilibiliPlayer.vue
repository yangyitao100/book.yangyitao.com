<script setup lang="ts">
import { ref, computed } from 'vue'

interface Episode {
  title: string
  bvid?: string
  page?: number
}

const props = withDefaults(defineProps<{
  /** 单视频多分P模式：传入 BV 号 */
  bvid?: string
  /** 多分P模式：总分P数（配合 bvid 使用） */
  pages?: number
  /** 分P标题列表（可选，默认显示"第 N 集"） */
  pageTitles?: string[]
  /** 合集模式：传入集数列表 */
  episodes?: Episode[]
  /** 系列标题 */
  title?: string
}>(), {
  pages: 0,
  pageTitles: () => [],
  episodes: () => [],
  title: '视频课程',
})

const currentIndex = ref(0)
const showList = ref(false)

const episodeList = computed<Episode[]>(() => {
  if (props.episodes.length > 0) return props.episodes
  if (props.bvid && props.pages > 0) {
    return Array.from({ length: props.pages }, (_, i) => ({
      title: props.pageTitles[i] || `第 ${i + 1} 集`,
      bvid: props.bvid,
      page: i + 1,
    }))
  }
  if (props.bvid) {
    return [{ title: props.title, bvid: props.bvid, page: 1 }]
  }
  return []
})

const total = computed(() => episodeList.value.length)

const iframeSrc = computed(() => {
  const ep = episodeList.value[currentIndex.value]
  if (!ep) return ''
  const bvid = ep.bvid || props.bvid
  const page = ep.page || 1
  return `//player.bilibili.com/player.html?bvid=${bvid}&page=${page}&high_quality=1&danmaku=0&autoplay=0`
})

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}

function next() {
  if (currentIndex.value < total.value - 1) currentIndex.value++
}

function goTo(index: number) {
  currentIndex.value = index
  showList.value = false
}
</script>

<template>
  <div class="bp-container" v-if="episodeList.length > 0">
    <!-- 标题栏 -->
    <div class="bp-header">
      <span class="bp-title">{{ title }}</span>
      <span class="bp-info" v-if="total > 1">
        {{ currentIndex + 1 }} / {{ total }}
      </span>
    </div>

    <!-- 播放器 -->
    <div class="bp-player">
      <iframe
        :src="iframeSrc"
        scrolling="no"
        border="0"
        frameborder="no"
        framespacing="0"
        allowfullscreen="true"
      />
    </div>

    <!-- 当前集标题 -->
    <div class="bp-current" v-if="total > 1">
      {{ episodeList[currentIndex].title }}
    </div>

    <!-- 控制栏 -->
    <div class="bp-controls" v-if="total > 1">
      <button class="bp-btn" :disabled="currentIndex === 0" @click="prev">
        ◀ 上一集
      </button>
      <button class="bp-btn bp-btn-list" @click="showList = !showList">
        ☰ 选集
      </button>
      <button class="bp-btn" :disabled="currentIndex === total - 1" @click="next">
        下一集 ▶
      </button>
    </div>

    <!-- 集数列表 -->
    <div class="bp-list" v-if="showList && total > 1">
      <div
        v-for="(ep, i) in episodeList"
        :key="i"
        class="bp-list-item"
        :class="{ active: i === currentIndex }"
        @click="goTo(i)"
      >
        <span class="bp-list-index">{{ i + 1 }}</span>
        <span class="bp-list-title">{{ ep.title }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bp-container {
  margin: 20px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg);
}

.bp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.bp-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--vp-c-text-1);
}

.bp-info {
  font-size: 13px;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.bp-player {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 */
  background: #000;
}

.bp-player iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.bp-current {
  padding: 10px 16px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
}

.bp-controls {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.bp-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bp-btn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.bp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bp-btn-list {
  flex: 0.8;
}

.bp-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

.bp-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.bp-list-item:hover {
  background: var(--vp-c-bg-soft);
}

.bp-list-item.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.bp-list-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.bp-list-item.active .bp-list-index {
  background: var(--vp-c-brand-1);
  color: #fff;
}

.bp-list-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
