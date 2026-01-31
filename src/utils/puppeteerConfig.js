import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { logger } from './logger.js';

/**
 * 获取系统 Chrome 浏览器路径
 * 支持 Windows、macOS 和 Linux
 * 
 * @returns {string|null} Chrome 可执行文件路径，如果找不到则返回 null
 */
function getSystemChromePath() {
  const platform = process.platform;
  
  // Windows 系统
  if (platform === 'win32') {
    const possiblePaths = [
      // Chrome 默认安装路径
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      // 用户安装路径
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      // Edge 浏览器（Chromium 内核）
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        logger.debug(`找到系统 Chrome: ${path}`);
        return path;
      }
    }
    
    // 尝试通过注册表查找（Windows）
    try {
      const regPath = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve 2>nul',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const match = regPath.match(/REG_SZ\s+(.+)/);
      if (match && existsSync(match[1].trim())) {
        logger.debug(`通过注册表找到 Chrome: ${match[1].trim()}`);
        return match[1].trim();
      }
    } catch (error) {
      // 忽略注册表查询错误
    }
  }
  
  // macOS 系统
  if (platform === 'darwin') {
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        logger.debug(`找到系统 Chrome: ${path}`);
        return path;
      }
    }
  }
  
  // Linux 系统
  if (platform === 'linux') {
    try {
      // 尝试使用 which 命令查找
      const chromePath = execSync('which google-chrome-stable || which google-chrome || which chromium-browser || which chromium', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      
      if (chromePath && existsSync(chromePath)) {
        logger.debug(`找到系统 Chrome: ${chromePath}`);
        return chromePath;
      }
    } catch (error) {
      // 忽略错误
    }
  }
  
  logger.warn('未找到系统 Chrome 浏览器，将使用 Puppeteer 自带的 Chromium');
  return null;
}

/**
 * 获取 Puppeteer 启动配置
 * 优先使用系统 Chrome，如果找不到则使用 Puppeteer 自带的 Chromium
 * 
 * @param {object} options - 用户选项
 * @returns {object} Puppeteer launch 配置
 */
export function getPuppeteerLaunchOptions(options = {}) {
  const {
    headless = true,
    args = [],
    ...otherOptions
  } = options;
  
  const launchOptions = {
    headless: headless === false ? false : "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      ...args
    ],
    ...otherOptions
  };
  
  // 优先尝试使用系统 Chrome（无论是否设置了 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD）
  const chromePath = getSystemChromePath();
  if (chromePath) {
    launchOptions.executablePath = chromePath;
    logger.info(`使用系统 Chrome: ${chromePath}`);
  } else {
    // 如果设置了跳过 Chromium 下载但找不到系统 Chrome，给出警告
    if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true') {
      logger.warn('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD 已设置，但未找到系统 Chrome，将尝试使用 Puppeteer 自带的 Chromium');
    } else {
      logger.info('未找到系统 Chrome，将使用 Puppeteer 自带的 Chromium');
    }
  }
  
  return launchOptions;
}
