import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'CarryBee Auto-Flow',
    description:
      'Automates the Order Processing flow on CarryBee. Supports Merchant Order ID, Customer Phone, COD Quantity, and Consignment ID modes.',
    version: '2.1.0',
    minimum_chrome_version: '109',
    permissions: ['storage', 'activeTab', 'alarms', 'commands', 'tabs'],
    commands: {
      'set-consignment-mode': {
        suggested_key: { default: 'Ctrl+Shift+1' },
        description: 'Set Consignment ID mode',
      },
      'set-phone-mode': {
        suggested_key: { default: 'Ctrl+Shift+2' },
        description: 'Set Customer Phone mode',
      },
      'set-merchant-mode': {
        suggested_key: { default: 'Ctrl+Shift+3' },
        description: 'Set Merchant Order ID mode',
      },
      'set-cod-mode': {
        suggested_key: { default: 'Ctrl+Shift+4' },
        description: 'Set COD Quantity mode',
      },
    },
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    content_scripts: [
      {
        matches: ['*://hive.carrybee.com/order-processing/*', '*://hive.carrybee.com/sub-sort/*'],
        run_at: 'document_idle',
        js: ['content-scripts/content.js'],
        css: ['content-scripts/content.css'],
      },
    ],
  },
  vite: () => ({
    plugins: [react()],
  }),
});
