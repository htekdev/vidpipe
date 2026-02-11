import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'VidPipe',
  description: 'Automated video processing pipeline — transcription, clips, captions, social publishing',
  base: '/vidpipe/',
  appearance: 'dark',

  markdown: {
    mermaid: true,
  },

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
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Brand Customization', link: '/guide/brand-customization' },
            { text: 'FFmpeg Setup', link: '/guide/ffmpeg-setup' },
            { text: 'Social Publishing', link: '/guide/social-publishing' },
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
})
