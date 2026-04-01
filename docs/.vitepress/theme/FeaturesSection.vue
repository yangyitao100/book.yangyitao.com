<script setup lang="ts">
const features = [
  {
    emoji: '\uD83D\uDD2C',
    title: '\u6E90\u7801\u7EA7\u6DF1\u5EA6',
    desc: '\u4E0D\u6B62\u4E8E API \u7528\u6CD5\uFF0C\u6BCF\u4E00\u7AE0\u90FD\u4ECE\u6E90\u7801\u5207\u5165\uFF0C\u9010\u884C\u5206\u6790\u6838\u5FC3\u5B9E\u73B0\u3002',
    gradient: 'linear-gradient(135deg, #3b82f6, #6366f1)',
  },
  {
    emoji: '\uD83C\uDFD7\uFE0F',
    title: '\u67B6\u6784\u601D\u7EF4',
    desc: '\u4ECE\u6574\u4F53\u8BBE\u8BA1\u5230\u6A21\u5757\u62C6\u5206\uFF0C\u5E2E\u4F60\u5EFA\u7ACB\u7CFB\u7EDF\u5316\u7684\u67B6\u6784\u8BA4\u77E5\u3002',
    gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
  },
  {
    emoji: '\u270D\uFE0F',
    title: '\u624B\u5199\u5B9E\u8DF5',
    desc: '\u914D\u5957\u624B\u5199\u5B9E\u73B0\uFF0C\u4ECE\u96F6\u6784\u5EFA\u7B80\u5316\u7248\u6846\u67B6\uFF0C\u771F\u6B63\u638C\u63E1\u6838\u5FC3\u539F\u7406\u3002',
    gradient: 'linear-gradient(135deg, #10b981, #34d399)',
  },
  {
    emoji: '\uD83C\uDD93',
    title: '\u5B8C\u5168\u514D\u8D39',
    desc: '\u6240\u6709\u4E66\u7C4D\u5185\u5BB9\u5F00\u6E90\u514D\u8D39\uFF0C\u6301\u7EED\u66F4\u65B0\u8FED\u4EE3\uFF0C\u65E0\u4EFB\u4F55\u4ED8\u8D39\u95E8\u69DB\u3002',
    gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
  },
  {
    emoji: '\uD83D\uDCF1',
    title: '\u6781\u81F4\u9605\u8BFB\u4F53\u9A8C',
    desc: '\u652F\u6301\u6697\u8272\u6A21\u5F0F\u3001\u5168\u6587\u641C\u7D22\u3001\u79FB\u52A8\u7AEF\u5B8C\u7F8E\u9002\u914D\u3002',
    gradient: 'linear-gradient(135deg, #ec4899, #f472b6)',
  },
  {
    emoji: '\uD83D\uDD04',
    title: '\u6301\u7EED\u66F4\u65B0',
    desc: '\u7D27\u8DDF\u6280\u672F\u524D\u6CBF\uFF0C\u5185\u5BB9\u5B9A\u671F\u66F4\u65B0\uFF0C\u786E\u4FDD\u77E5\u8BC6\u4E0D\u8FC7\u65F6\u3002',
    gradient: 'linear-gradient(135deg, #06b6d4, #22d3ee)',
  },
]
</script>

<template>
  <section class="features-section">
    <div class="features-container">
      <div class="section-header">
        <span class="section-label">FEATURES</span>
        <h2 class="section-title">为什么选择这里</h2>
        <p class="section-desc">我们追求技术内容的深度与品质</p>
      </div>
      <div class="features-grid">
        <div v-for="f in features" :key="f.title" class="feature-card">
          <div class="feature-icon" :style="{ background: f.gradient }">
            {{ f.emoji }}
          </div>
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.features-section {
  padding: 100px 24px;
  background: var(--home-bg-alt);
}

.features-container {
  max-width: 960px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 64px;
}

.section-label {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--vp-c-brand-1);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 800;
  color: var(--home-text-1);
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}

.section-desc {
  font-size: 16px;
  color: var(--home-text-3);
  margin: 0;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.feature-card {
  padding: 32px 28px;
  background: var(--home-card-bg);
  border: 1px solid var(--home-card-border);
  border-radius: 14px;
  transition: all 0.25s var(--ease-out);
}

.feature-card:hover {
  box-shadow: var(--home-card-shadow-hover);
  transform: translateY(-2px);
}

.feature-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.feature-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--home-text-1);
  margin: 0 0 8px;
}

.feature-desc {
  font-size: 14px;
  line-height: 1.65;
  color: var(--home-text-2);
  margin: 0;
}

@media (max-width: 768px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
  .features-section {
    padding: 64px 16px;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
