import { defineConfig } from 'vite';
import headers from './security-headers.json';

export default defineConfig({
  preview: { headers },
  plugins: [{
    name: 'remove-production-developer-controls',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/<!-- DEV_ONLY_START -->[\s\S]*?<!-- DEV_ONLY_END -->/g, '');
    },
  }, {
    name: 'netlify-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset', fileName: '_headers',
        source: '/*\n' + Object.entries(headers).map(([name, value]) => `  ${name}: ${value}\n`).join('')
          + '/\n  Cache-Control: no-cache\n',
      });
    },
  }],
});
