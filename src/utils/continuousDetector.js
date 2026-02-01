import puppeteer from 'puppeteer';
import { EventEmitter } from 'events';
import { logger } from './logger.js';
import { isVideoUrl, getVideoSize, formatFileSize } from './videoUtils.js';
import { getPuppeteerLaunchOptions } from './puppeteerConfig.js';

/**
 * 持续检测管理器
 * 保持浏览器打开，持续监听新视频并实时推送
 */
class ContinuousDetector extends EventEmitter {
  constructor() {
    super();
    this.detectors = new Map(); // sessionId -> { browser, page, videoUrlMap, isRunning }
  }

  /**
   * 启动持续检测
   * @param {string} sessionId - 会话ID
   * @param {string} url - 页面URL
   * @param {object} options - 选项
   */
  async startDetection(sessionId, url, options = {}) {
    const {
      headless = false, // 持续检测默认显示浏览器，方便用户操作
      timeout = 60000
    } = options;

    // 如果已经存在，先停止旧的
    if (this.detectors.has(sessionId)) {
      await this.stopDetection(sessionId);
    }

    let browser = null;
    let page = null;
    const videoUrlMap = new Map(); // 存储已发现的视频URL

    try {
      logger.info(`启动持续检测: ${sessionId}, URL: ${url}`);

      // 启动浏览器
      browser = await puppeteer.launch(
        getPuppeteerLaunchOptions({
          headless,
          args: []
        })
      );

      page = await browser.newPage();

      // 设置真实的 User-Agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // 隐藏 webdriver 特征
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
      });

      // 监听所有网络响应，检测视频 URL
      page.on('response', async (response) => {
        try {
          const responseUrl = response.url();
          const headers = response.headers();
          const contentType = headers['content-type'] || '';

          // 检测是否是视频 URL
          if (isVideoUrl(responseUrl, contentType)) {
            // 如果这是新发现的视频
            if (!videoUrlMap.has(responseUrl)) {
              // 尝试从响应头获取文件大小
              const contentLength = headers['content-length'];
              let sizeInfo = null;
              
              if (contentLength) {
                const size = parseInt(contentLength, 10);
                if (!isNaN(size) && size > 0) {
                  sizeInfo = {
                    size,
                    formattedSize: formatFileSize(size)
                  };
                }
              }

              const videoInfo = {
                url: responseUrl,
                contentType,
                size: sizeInfo?.size || null,
                formattedSize: sizeInfo?.formattedSize || null,
                discoveredAt: new Date().toISOString()
              };

              videoUrlMap.set(responseUrl, videoInfo);
              
              logger.info(`发现新视频: ${responseUrl}${sizeInfo ? ` (${sizeInfo.formattedSize})` : ''}`);

              // 实时推送新发现的视频
              this.emit('newVideo', {
                sessionId,
                video: videoInfo
              });
            }
          }
        } catch (error) {
          logger.debug('处理响应时出错:', error.message);
        }
      });

      // 导航到页面
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout
      });

      // 等待一段时间，确保初始资源加载完成
      await page.waitForTimeout(2000);

      // 记录初始发现的视频
      const initialVideos = Array.from(videoUrlMap.values());
      logger.info(`初始检测完成，找到 ${initialVideos.length} 个视频 URL`);

      // 保存检测器状态
      this.detectors.set(sessionId, {
        browser,
        page,
        videoUrlMap,
        url,
        isRunning: true,
        startTime: Date.now()
      });

      // 发送初始视频列表
      this.emit('started', {
        sessionId,
        initialVideos
      });

      return {
        sessionId,
        url,
        initialVideos,
        message: '持续检测已启动，浏览器将保持打开状态'
      };
    } catch (error) {
      // 清理资源
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // 忽略关闭错误
        }
      }
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          // 忽略关闭错误
        }
      }

      logger.error(`启动持续检测失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 停止持续检测
   * @param {string} sessionId - 会话ID
   */
  async stopDetection(sessionId) {
    const detector = this.detectors.get(sessionId);
    if (!detector) {
      logger.warn(`检测会话不存在: ${sessionId}`);
      return;
    }

    try {
      logger.info(`停止持续检测: ${sessionId}`);

      detector.isRunning = false;

      // 关闭浏览器
      if (detector.browser) {
        await detector.browser.close();
      }

      // 获取最终视频列表
      const finalVideos = Array.from(detector.videoUrlMap.values());

      // 移除检测器
      this.detectors.delete(sessionId);

      // 发送停止事件
      this.emit('stopped', {
        sessionId,
        finalVideos
      });

      return {
        sessionId,
        finalVideos,
        message: '持续检测已停止'
      };
    } catch (error) {
      logger.error(`停止持续检测失败: ${error.message}`);
      // 即使出错也移除
      this.detectors.delete(sessionId);
      throw error;
    }
  }

  /**
   * 获取检测器状态
   * @param {string} sessionId - 会话ID
   */
  getDetectorStatus(sessionId) {
    const detector = this.detectors.get(sessionId);
    if (!detector) {
      return null;
    }

    return {
      sessionId,
      url: detector.url,
      isRunning: detector.isRunning,
      videoCount: detector.videoUrlMap.size,
      startTime: detector.startTime,
      duration: Date.now() - detector.startTime
    };
  }

  /**
   * 获取所有检测器状态
   */
  getAllDetectorStatus() {
    const statuses = [];
    for (const [sessionId, detector] of this.detectors.entries()) {
      statuses.push({
        sessionId,
        url: detector.url,
        isRunning: detector.isRunning,
        videoCount: detector.videoUrlMap.size,
        startTime: detector.startTime,
        duration: Date.now() - detector.startTime
      });
    }
    return statuses;
  }
}

// 单例模式
export const continuousDetector = new ContinuousDetector();
