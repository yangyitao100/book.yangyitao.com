import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { sidebar } from './sidebar'

export default withMermaid(defineConfig({
  title: '杨艺韬讲堂',
  description: '高质量技术书籍，免费在线阅读',
  lang: 'zh-CN',
  base: '/',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  vite: {
    plugins: [
      {
        name: 'md-vpre',
        // 不设 enforce，运行在 vitepress markdown 转换之后、vue 编译之前
        transform(code: string, id: string) {
          // VitePress 在内部会对 .md 文件用 vitepress:markdown 插件先转换
          // 转换后的 id 可能带 .md 后缀，code 已经是 Vue SFC 格式
          if (!id.includes('.md')) return
          if (!id.includes('/books/') || id.match(/index\.md/)) return
          // 给 <template> 内容加 v-pre，阻止 Vue 编译器解析
          if (code.includes('<template>')) {
            const newCode = code
              .replace(/<template>/, '<template><div v-pre>')
              .replace(/<\/template>/, '</div></template>')
            return { code: newCode, map: null }
          }
        },
      },
    ],
  },

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: '杨艺韬讲堂',
    // @ts-ignore — VitePress 支持 logoLink 但类型定义可能未包含
    logoLink: 'https://www.yangyitao.com',
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
      copyright: 'Copyright © 2024-present 杨艺韬',
    },
  },

  mermaid: {
    theme: 'default',
  },
}))
