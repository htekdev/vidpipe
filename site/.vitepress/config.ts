import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'VidPipe',
  description: 'AI-powered video editor — turn raw recordings into shorts, social clips, captions, and blog posts',
  base: '/vidpipe/',
  appearance: 'dark',

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/pipeline-stages' },
      { text: 'GitHub', link: 'https://github.com/htekdev/vidpipe' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Brand Customization', link: '/guide/brand-customization' },
            { text: 'Social Publishing', link: '/guide/social-publishing' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'FFmpeg Setup', link: '/guide/ffmpeg-setup' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Pipeline Stages', link: '/reference/pipeline-stages' },
            { text: 'Late API', link: '/reference/late-api' },
            { text: 'CLI Commands', link: '/reference/cli-commands' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/htekdev/vidpipe' },
    ],
  },
}))