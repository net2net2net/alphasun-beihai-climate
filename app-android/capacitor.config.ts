import { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  // 应用包名（按需自行修改，避免与他人冲突）
  appId: 'net.net2net.alphasun',
  appName: 'AlphaSun北海气候',
  // 静态前端资源目录（已就绪）
  webDir: 'www',
  // 使用 https scheme 加载 WebView，CORS / fetch 行为更稳定
  server: {
    androidScheme: 'https',
  },
  android: {
    // 允许混合内容（部分底图/接口为 http 时仍可加载）
    allowMixedContent: true,
  },
  ios: {
    // iOS 同样复用 www/ 前端；如需访问 http 接口可开启下面一项
    // allowMixedContent: true,
  },
};

export default config;
