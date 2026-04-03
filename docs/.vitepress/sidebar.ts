import type { DefaultTheme } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

function extractTitle(filePath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const match = content.match(/^#\s+(.+)$/m)
    if (match) return match[1]
  } catch {}
  return fallback
}

function generateBookSidebar(
  bookDir: string,
  bookName: string,
  indexLink: string,
): DefaultTheme.SidebarItem[] {
  const base = path.resolve(__dirname, `../books/${bookDir}/chapters`)
  const files = fs.readdirSync(base).filter(f => f.endsWith('.md')).sort()
  const items: DefaultTheme.SidebarItem[] = [
    { text: '简介', link: indexLink },
    ...files.map(f => {
      const name = f.replace('.md', '')
      const title = extractTitle(path.join(base, f), name)
      return { text: title, link: `/books/${bookDir}/chapters/${name}` }
    }),
  ]
  return [{ text: bookName, items }]
}

export const sidebar: DefaultTheme.Sidebar = {
  '/books/openclaw/': [
    {
      text: 'OpenClaw设计与实现',
      items: [
        { text: '简介', link: '/books/openclaw/' },
        { text: '前言', link: '/books/openclaw/chapters/00-preface' },
      ],
    },
    {
      text: '核心架构',
      items: [
        { text: '第1章 为什么需要OpenClaw', link: '/books/openclaw/chapters/01-why-openclaw' },
        { text: '第2章 架构总览', link: '/books/openclaw/chapters/02-architecture' },
        { text: '第3章 Gateway网关引擎', link: '/books/openclaw/chapters/03-gateway' },
        { text: '第4章 Provider抽象层', link: '/books/openclaw/chapters/04-provider' },
        { text: '第5章 Session与对话管理', link: '/books/openclaw/chapters/05-session' },
      ],
    },
    {
      text: 'Agent与通道',
      items: [
        { text: '第6章 Agent系统', link: '/books/openclaw/chapters/06-agent' },
        { text: '第7章 通道架构', link: '/books/openclaw/chapters/07-channel-arch' },
        { text: '第8章 通道实现深度剖析', link: '/books/openclaw/chapters/08-channel-impl' },
      ],
    },
    {
      text: '扩展与工具',
      items: [
        { text: '第9章 插件与扩展系统', link: '/books/openclaw/chapters/09-plugin' },
        { text: '第10章 工具系统', link: '/books/openclaw/chapters/10-tool' },
        { text: '第11章 Node系统与设备连接', link: '/books/openclaw/chapters/11-node' },
        { text: '第16章 技能系统', link: '/books/openclaw/chapters/16-skill' },
      ],
    },
    {
      text: '运维与实践',
      items: [
        { text: '第12章 定时任务与自动化', link: '/books/openclaw/chapters/12-scheduler' },
        { text: '第13章 安全与权限', link: '/books/openclaw/chapters/13-security' },
        { text: '第14章 CLI与交互界面', link: '/books/openclaw/chapters/14-cli' },
        { text: '第15章 部署与运维', link: '/books/openclaw/chapters/15-deploy' },
      ],
    },
    {
      text: '总结与展望',
      items: [
        { text: '第17章 设计模式与架构决策', link: '/books/openclaw/chapters/17-design-patterns' },
        { text: '第18章 构建你自己的Agent帝国', link: '/books/openclaw/chapters/18-build-empire' },
      ],
    },
    {
      text: '附录',
      collapsed: true,
      items: [
        { text: '附录A 配置速查表', link: '/books/openclaw/appendix/a-config' },
        { text: '附录B 源码文件索引', link: '/books/openclaw/appendix/b-source-index' },
        { text: '附录C 对比表速查', link: '/books/openclaw/appendix/c-comparison' },
        { text: '附录D 开发者速查手册', link: '/books/openclaw/appendix/d-dev-handbook' },
        { text: '作者简介', link: '/books/openclaw/chapters/author' },
        { text: '参考文献', link: '/books/openclaw/chapters/bibliography' },
        { text: '术语索引', link: '/books/openclaw/chapters/glossary' },
      ],
    },
  ],
  '/books/react18/': generateBookSidebar('react18', 'React 19 内核探秘', '/books/react18/'),
  '/books/vue3/': generateBookSidebar('vue3', 'Vue3源码剖析', '/books/vue3/'),
  '/books/microfe/': generateBookSidebar('microfe', '微前端源码剖析', '/books/microfe/'),
}
