# Swell Node Video Downloader

基于 Node.js 和 Express 的视频下载应用，支持 HLS、DASH 等多种流媒体格式。

## 功能特性

- ✅ 支持 HLS (m3u8) 流媒体下载
- ✅ 支持 DASH (mpd) 流媒体下载
- ✅ 支持直接视频文件下载
- ✅ 支持 Instagram、TikTok 等平台
- ✅ 使用 Puppeteer 安全地检测视频 URL
- ✅ RESTful API 接口
- ✅ 并发下载，提高效率
- ✅ 自动重试机制

## 安全说明

本项目使用标准的 Node.js 库和安全的实现方式：

- 使用 Puppeteer 监听网络请求，不注入任何恶意代码
- 不修改页面内容，不执行可疑脚本
- 只使用公开的 API 和标准的 HTTP 请求
- 所有操作都在本地完成，不发送数据到外部服务器

## 安装

```bash
npm install
```

## 运行

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务器默认运行在 `http://localhost:3000`

## API 接口

### 1. 检测视频 URL

```bash
POST /api/video/detect
Content-Type: application/json

{
  "url": "https://example.com/video-page"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/video-page",
    "videoUrls": ["https://example.com/video.m3u8"],
    "count": 1
  }
}
```

### 2. 下载视频

```bash
POST /api/video/download
Content-Type: application/json

{
  "url": "https://example.com/video.m3u8",
  "outputPath": "./downloads/video.mp4",
  "options": {
    "concurrency": 5,
    "retries": 3
  }
}
```

响应：

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/video.m3u8",
    "outputPath": "./downloads/video.mp4",
    "size": 12345678,
    "segments": 100,
    "message": "下载完成"
  }
}
```

### 3. 健康检查

```bash
GET /health
```

## 项目结构

```
swell-node-video-downloader/
├── src/
│   ├── core/              # 核心功能模块
│   │   ├── detector.js    # 视频 URL 检测
│   │   ├── downloader.js  # 下载主入口
│   │   ├── hls-handler.js # HLS 处理
│   │   ├── dash-handler.js # DASH 处理
│   │   └── direct-handler.js # 直接下载
│   ├── platforms/         # 平台特定支持
│   │   ├── instagram.js   # Instagram
│   │   └── tiktok.js      # TikTok
│   ├── utils/             # 工具函数
│   │   ├── logger.js      # 日志工具
│   │   └── videoUtils.js  # 视频工具
│   ├── routes/            # 路由
│   │   └── video.js       # 视频相关路由
│   ├── middleware/        # 中间件
│   │   └── errorHandler.js # 错误处理
│   └── server.js          # 服务器入口
├── downloads/             # 下载文件目录（自动创建）
├── temp/                  # 临时文件目录（自动创建）
├── package.json
└── README.md
```

## 环境变量

创建 `.env` 文件（可选）：

```env
PORT=3000
DEBUG=false

# Puppeteer 配置：跳过 Chromium 下载，使用系统 Chrome
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

## Puppeteer 配置

### 使用系统 Chrome（推荐）

为了避免 Puppeteer 自动下载 Chromium，可以配置使用系统已安装的 Chrome：

1. **设置环境变量**：在 `.env` 文件中添加 `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
2. **确保系统已安装 Chrome**：项目会自动检测并使用系统 Chrome 浏览器
   - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
   - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Linux: 通过 `which google-chrome` 查找

如果未找到系统 Chrome，项目会自动回退到使用 Puppeteer 自带的 Chromium。

### 手动安装 Chromium（备选方案）

如果不想使用系统 Chrome，也可以手动安装 Chromium：

```bash
# 使用默认源（可能较慢）
npx puppeteer browsers install chrome

# 使用国内镜像加速（推荐国内用户）
pnpm run install-browser:cn
# 或
npm run install-browser:cn
```

**国内镜像加速说明**：

- 项目已配置 `.npmrc` 文件，使用 npmmirror 镜像加速下载
- 如果 `install-browser` 命令速度慢，可以使用以下方式加速：

  **方式 1：使用 npm 脚本（推荐）**

  ```bash
  pnpm run install-browser:cn
  # 或
  npm run install-browser:cn
  ```

  **方式 2：使用安装脚本**

  ```bash
  # Windows PowerShell
  .\scripts\install-browser-cn.ps1

  # Linux/macOS
  chmod +x scripts/install-browser-cn.sh
  ./scripts/install-browser-cn.sh
  ```

  **方式 3：手动设置环境变量**

  ```bash
  # Windows PowerShell
  $env:PUPPETEER_DOWNLOAD_HOST="https://registry.npmmirror.com/-/binary/chrome-for-testing"
  npx puppeteer browsers install chrome

  # Linux/macOS
  export PUPPETEER_DOWNLOAD_HOST="https://registry.npmmirror.com/-/binary/chrome-for-testing"
  npx puppeteer browsers install chrome
  ```

## 注意事项

1. **FFmpeg 依赖**：合并视频片段需要安装 FFmpeg。如果没有安装，会回退到简单的文件拼接（可能不兼容）。
2. **Puppeteer**：如果未设置 `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`，首次运行会自动下载 Chromium，可能需要一些时间。
3. **磁盘空间**：下载大视频文件需要足够的磁盘空间。
4. **网络**：确保网络连接稳定，特别是下载流媒体片段时。

## 许可证

ISC

推荐方式（最简单）：
pnpm run install-browser:cn
或者使用脚本：

# Windows PowerShell.\scripts\install-browser-cn.ps1

现在可以使用 pnpm run install-browser:cn 命令快速安装 Chrome 浏览器了。

C:\Users\lang\.cache\puppeteer\chrome\win64-121.0.6167.85\chrome-win64\chrome.exe
