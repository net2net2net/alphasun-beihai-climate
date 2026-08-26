import { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  // 应用包名（按需自行修改，避免与他人冲突）
  appId: 'net.net2net.alphasun',
  appName: 'AlphaSun北海气候',
  // 静态前端资源目录（已就绪）
  webDir: 'www',
  // 使用 https scheme 加载 WebView，CORS / fetch 行为更稳定
  // 注意：仅 Android 可设 https scheme；iOS 的 WKWebView 不允许接管 http/https，
  // 故 iosScheme 不可设为 'https'（会破坏构建），iOS 用默认的 capacitor://localhost。
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
  // ===== iOS/Android CORS 核心修复 =====
  // 启用 CapacitorHttp：将 WebView 内的 fetch / XMLHttpRequest 改写为走原生 HTTP
  // （iOS=NSURLSession，Android=HttpURLConnection），原生网络请求不受浏览器 CORS 限制。
  // 这彻底解决「iOS 版很多模块取不到数据」的问题（capacitor://localhost 不透明源下
  // WKWebView 的 fetch 跨域被拦），无需改任何业务代码，且对 Web/PWA 无影响。
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
