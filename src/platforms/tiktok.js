import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';
import { isVideoUrl, getVideoSize, formatFileSize } from '../utils/videoUtils.js';
import { getPuppeteerLaunchOptions } from '../utils/puppeteerConfig.js';

/**
 * 从 TikTok 页面提取视频 URL
 * 使用 Puppeteer 监听网络请求，安全地提取视频
 * 
 * @param {string} url - TikTok 页面 URL
 * @param {object} options - 选项
 * @returns {Promise<Array>} 视频 URL 列表
 */
export async function getTikTokVideo(url, options = {}) {
  let browser = null;
  const videoUrlMap = new Map(); // 存储视频 URL 和其元数据

  try {
    logger.info(`检测 TikTok 视频: ${url}`);

    browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: options.headless,
        args: []
      })
    );

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 隐藏 webdriver 特征
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });

    // 监听所有网络响应，特别是 TikTok CDN
    page.on('response', async (response) => {
      try {
        const responseUrl = response.url();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';

        // TikTok CDN 域名
        if (responseUrl.includes('tiktokcdn.com') || 
            responseUrl.includes('tiktok.com')) {
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
            
            logger.info(`检测到 TikTok 视频 URL: ${responseUrl}${sizeInfo ? ` (${sizeInfo.formattedSize})` : ''}`);
          }
        }

        // 监听 TikTok API 响应
        if (responseUrl.includes('tiktok.com/api') || 
            responseUrl.includes('tiktok.com/node')) {
          try {
            const data = await response.json();
            extractVideoFromAPI(data, videoUrlMap);
          } catch (error) {
            // 忽略 JSON 解析错误
          }
        }
      } catch (error) {
        logger.debug('处理响应时出错:', error.message);
      }
    });

    // 导航到页面
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: options.timeout || 30000
    });

    // 等待视频加载
    await page.waitForTimeout(3000);

    logger.info(`TikTok 检测完成，找到 ${videoUrlMap.size} 个视频 URL`);

    // 对于没有从响应头获取到大小的视频，尝试单独获取
    const videoList = Array.from(videoUrlMap.values());
    const videosWithSize = await Promise.all(
      videoList.map(async (video) => {
        // 如果已经有大小信息，直接返回
        if (video.size) {
          return video;
        }

        // 尝试获取视频大小
        logger.debug(`尝试获取 TikTok 视频大小: ${video.url}`);
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
    logger.error('检测 TikTok 视频失败:', error.message);
    throw new Error(`检测 TikTok 视频失败: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 从 API 响应中提取视频 URL
 */
function extractVideoFromAPI(data, videoUrlMap) {
  // 递归搜索视频 URL
  if (typeof data === 'object' && data !== null) {
    for (const key in data) {
      if (key === 'video' || key === 'downloadAddr' || key === 'playAddr' || 
          key === 'videoUrl' || key === 'video_url') {
        if (typeof data[key] === 'string' && isVideoUrl(data[key])) {
          videoUrlMap.set(data[key], {
            url: data[key],
            contentType: null,
            size: null,
            formattedSize: null
          });
        } else if (typeof data[key] === 'object' && data[key].urlList) {
          // TikTok 可能使用 urlList 数组
          data[key].urlList.forEach(url => {
            if (isVideoUrl(url)) {
              videoUrlMap.set(url, {
                url: url,
                contentType: null,
                size: null,
                formattedSize: null
              });
            }
          });
        }
      } else if (typeof data[key] === 'object') {
        extractVideoFromAPI(data[key], videoUrlMap);
      }
    }
  }
}
