import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { sidebar } from './sidebar'

export default withMermaid(defineConfig({
  title: 'Open Books',
  description: '开源电子书阅读站',
  lang: 'zh-CN',
  base: '/book.yangyitao.com/',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      {
        text: '书籍',
        items: [
          { text: 'OpenClaw设计与实现', link: '/books/openclaw/' },
          { text: 'React18内核探秘', link: '/books/react18/' },
          { text: 'Vue3源码剖析', link: '/books/vue3/' },
          { text: '微前端源码剖析', link: '/books/microfe/' },
        ],
      },
    ],

    sidebar,

    socialLinks: [
      { icon: 'github', link: 'https://github.com/yangyitao100' },
    ],

    outline: {
      level: [2, 3],
      label: '目录',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdated: {
      text: '最后更新于',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除搜索条件',
            footer: { selectText: '选择', navigateText: '导航', closeText: '关闭' },
          },
        },
      },
    },

    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2024-present',
    },
  },

  mermaid: {
    theme: 'default',
  },
}))
