import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';
import { isVideoUrl, getVideoSize, formatFileSize } from '../utils/videoUtils.js';
import { getInstagramVideo } from '../platforms/instagram.js';
import { getTikTokVideo } from '../platforms/tiktok.js';
import { getPuppeteerLaunchOptions } from '../utils/puppeteerConfig.js';

/**
 * 检测页面中的视频 URL
 * 使用 Puppeteer 监听网络请求，安全地检测视频资源
 * 
 * @param {string} url - 要检测的页面 URL
 * @param {object} options - 选项
 * @param {string} options.buttonSelector - 需要点击的按钮选择器（可选）
 * @param {number} options.clickWaitTime - 点击按钮后等待时间（毫秒，默认3000）
 * @returns {Promise<Array>} 视频 URL 列表
 */
export async function detectVideoUrl(url, options = {}) {
  const {
    timeout = 30000,
    waitUntil = 'networkidle2',
    headless = true,
    buttonSelector = null,
    clickWaitTime = 3000
  } = options;

  // 检查是否是特定平台
  if (url.includes('instagram.com')) {
    return await getInstagramVideo(url, options);
  }

  if (url.includes('tiktok.com')) {
    return await getTikTokVideo(url, options);
  }

  // 通用检测
  return await detectVideoUrlGeneric(url, { 
    timeout, 
    waitUntil, 
    headless,
    buttonSelector,
    clickWaitTime
  });
}

/**
 * 通用视频 URL 检测
 * 使用 Puppeteer 监听网络请求，不注入任何恶意代码
 */
async function detectVideoUrlGeneric(url, options) {
  let browser = null;
  const {
    buttonSelector = null,
    clickWaitTime = 3000
  } = options;

  try {
    logger.info(`启动浏览器检测视频 URL: ${url}`);

    // 启动浏览器，使用安全的配置
    try {
      browser = await puppeteer.launch(
        getPuppeteerLaunchOptions({
          headless: options.headless,
          args: []
        })
      );
    } catch (launchError) {
      // 如果启动失败，检查是否是浏览器未找到的错误
      if (launchError.message && launchError.message.includes('Could not find Chrome')) {
        const errorMsg = `无法找到 Chrome 浏览器。请执行以下操作之一：
1. 安装 Google Chrome 浏览器
2. 或者运行以下命令安装 Puppeteer 自带的 Chromium：
   npx puppeteer browsers install chrome
3. 或者安装 Microsoft Edge 浏览器（也支持）`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      throw launchError;
    }

    const page = await browser.newPage();

    // 设置真实的 User-Agent，避免被识别为爬虫
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 隐藏 webdriver 特征（避免反爬虫检测）
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });

    // 监听所有网络响应，检测视频 URL
    const videoUrlMap = new Map(); // 存储视频 URL 和其元数据
    let videoCountBeforeClick = 0; // 点击按钮前的视频数量

    page.on('response', async (response) => {
      try {
        const responseUrl = response.url();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';

        // 检测是否是视频 URL
        if (isVideoUrl(responseUrl, contentType)) {
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

          videoUrlMap.set(responseUrl, {
            url: responseUrl,
            contentType,
            size: sizeInfo?.size || null,
            formattedSize: sizeInfo?.formattedSize || null
          });
          
          logger.info(`检测到视频 URL: ${responseUrl}${sizeInfo ? ` (${sizeInfo.formattedSize})` : ''}`);
        }
      } catch (error) {
        logger.debug('处理响应时出错:', error.message);
      }
    });

    // 导航到页面
    await page.goto(url, {
      waitUntil: options.waitUntil,
      timeout: options.timeout
    });

    // 等待一段时间，确保所有资源加载完成
    await page.waitForTimeout(2000);

    // 记录点击前的视频数量
    videoCountBeforeClick = videoUrlMap.size;
    logger.info(`初始检测完成，找到 ${videoCountBeforeClick} 个视频 URL`);

    // 如果需要点击按钮来触发新视频下载
    if (buttonSelector) {
      try {
        logger.info(`尝试点击按钮: ${buttonSelector}`);
        
        // 等待按钮元素出现
        await page.waitForSelector(buttonSelector, { 
          timeout: 10000,
          visible: true 
        }).catch(() => {
          logger.warn(`未找到按钮元素: ${buttonSelector}`);
        });

        // 检查按钮是否存在且可见
        const buttonExists = await page.$(buttonSelector);
        if (buttonExists) {
          // 检查按钮是否在视口中
          const isVisible = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.left >= 0 && 
                   rect.bottom <= window.innerHeight && 
                   rect.right <= window.innerWidth;
          }, buttonSelector);

          if (!isVisible) {
            // 如果按钮不在视口中，滚动到按钮位置
            await page.evaluate((selector) => {
              const element = document.querySelector(selector);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, buttonSelector);
            await page.waitForTimeout(500);
          }

          // 点击按钮
          await buttonExists.click();
          logger.info('按钮点击成功');

          // 等待新视频加载
          logger.info(`等待 ${clickWaitTime}ms 以加载新视频...`);
          await page.waitForTimeout(clickWaitTime);

          // 等待网络响应（等待新视频请求）
          try {
            await Promise.race([
              new Promise(resolve => setTimeout(resolve, 2000)),
              page.waitForResponse(() => true, { timeout: 5000 }).catch(() => {})
            ]);
          } catch (e) {
            // 忽略超时错误
          }

          const videoCountAfterClick = videoUrlMap.size;
          const newVideosCount = videoCountAfterClick - videoCountBeforeClick;
          logger.info(`点击后检测完成，新增 ${newVideosCount} 个视频 URL，总计 ${videoCountAfterClick} 个`);
        } else {
          logger.warn(`按钮元素不存在: ${buttonSelector}`);
        }
      } catch (error) {
        logger.warn(`点击按钮时出错: ${error.message}，继续检测已有视频`);
      }
    }

    logger.info(`检测完成，找到 ${videoUrlMap.size} 个视频 URL`);

    // 对于没有从响应头获取到大小的视频，尝试单独获取
    const videoList = Array.from(videoUrlMap.values());
    const videosWithSize = await Promise.all(
      videoList.map(async (video) => {
        // 如果已经有大小信息，直接返回
        if (video.size) {
          return video;
        }

        // 尝试获取视频大小（对于流媒体可能无法获取）
        logger.debug(`尝试获取视频大小: ${video.url}`);
        const sizeInfo = await getVideoSize(video.url, { timeout: 5000 });
        
        return {
          ...video,
          size: sizeInfo?.size || null,
          formattedSize: sizeInfo?.formattedSize || null
        };
      })
    );

    return videosWithSize;
  } catch (error) {
    logger.error('检测视频 URL 时出错:', error.message);
    throw new Error(`检测视频 URL 失败: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
