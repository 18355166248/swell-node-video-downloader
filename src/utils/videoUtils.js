import axios from 'axios';
import { logger } from './logger.js';

/**
 * 视频工具函数
 * 用于检测和判断视频 URL
 */

/**
 * 格式化文件大小
 * 将字节数转换为可读格式 (B, KB, MB, GB)
 * 
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小字符串
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) {
    return '0B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size = Math.round((size / 1024) * 100) / 100;
    unitIndex++;
  }

  return `${size}${units[unitIndex]}`;
}

/**
 * 获取视频文件大小
 * 通过 HEAD 请求获取 Content-Length 响应头
 * 
 * @param {string} url - 视频 URL
 * @param {object} options - 选项
 * @returns {Promise<object|null>} 返回 { size: number, formattedSize: string } 或 null
 */
export async function getVideoSize(url, options = {}) {
  try {
    const { timeout = 10000 } = options;

    // 使用 HEAD 请求获取文件大小（不下载文件内容）
    const response = await axios.head(url, {
      timeout,
      validateStatus: (status) => status < 500, // 允许 404 等状态
      maxRedirects: 5
    });

    // 检查响应状态
    if (response.status !== 200) {
      logger.debug(`获取视频大小失败，状态码: ${response.status}, URL: ${url}`);
      return null;
    }

    // 获取 Content-Length
    const contentLength = response.headers['content-length'];
    
    if (!contentLength) {
      logger.debug(`未找到 Content-Length 响应头, URL: ${url}`);
      return null;
    }

    const size = parseInt(contentLength, 10);
    
    if (isNaN(size) || size <= 0) {
      logger.debug(`无效的文件大小: ${contentLength}, URL: ${url}`);
      return null;
    }

    return {
      size,
      formattedSize: formatFileSize(size)
    };
  } catch (error) {
    // 如果 HEAD 请求失败，可能是服务器不支持 HEAD，尝试 GET 请求但只读取响应头
    if (error.response && error.response.status === 405) {
      // Method Not Allowed，尝试使用 GET 请求
      try {
        const response = await axios.get(url, {
          timeout: options.timeout || 10000,
          validateStatus: () => true,
          maxRedirects: 5,
          // 只读取响应头，不下载内容
          maxContentLength: 0,
          maxBodyLength: 0
        });

        const contentLength = response.headers['content-length'];
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (!isNaN(size) && size > 0) {
            return {
              size,
              formattedSize: formatFileSize(size)
            };
          }
        }
      } catch (getError) {
        logger.debug(`获取视频大小失败: ${getError.message}, URL: ${url}`);
      }
    } else {
      logger.debug(`获取视频大小失败: ${error.message}, URL: ${url}`);
    }
    
    return null;
  }
}

/**
 * 判断是否是视频 URL
 * 
 * @param {string} url - URL 字符串
 * @param {string} contentType - Content-Type 响应头
 * @returns {boolean}
 */
export function isVideoUrl(url, contentType = '') {
  // 视频文件扩展名
  const videoFormats = [
    '.m3u8', '.mpd', '.mp4', '.webm',
    '.flv', '.3gp', '.avi', '.wmv',
    '.mov', '.mkv', '.ts', '.m4v'
  ];

  // 视频 MIME 类型
  const videoTypes = [
    'video/',
    'application/vnd.apple.mpegurl', // HLS
    'application/dash+xml', // DASH
    'application/x-mpegURL' // HLS 变体
  ];

  // 检查 URL 是否包含视频格式
  const hasVideoFormat = videoFormats.some(format => 
    url.toLowerCase().includes(format)
  );

  // 检查 Content-Type 是否是视频类型
  const hasVideoType = videoTypes.some(type => 
    contentType.toLowerCase().includes(type.toLowerCase())
  );

  return hasVideoFormat || hasVideoType;
}

/**
 * 判断是否是 HLS 流
 */
export function isHLS(url, contentType = '') {
  return url.includes('.m3u8') ||
         contentType.includes('application/vnd.apple.mpegurl') ||
         contentType.includes('application/x-mpegURL');
}

/**
 * 判断是否是 DASH 流
 */
export function isDASH(url, contentType = '') {
  return url.includes('.mpd') ||
         contentType.includes('application/dash+xml');
}

/**
 * 从 URL 提取文件名
 */
export function extractFilename(url, defaultName = 'video') {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    if (filename && filename.includes('.')) {
      return filename;
    }
    
    // 如果没有文件名，根据 URL 特征生成
    if (url.includes('.m3u8')) {
      return `${defaultName}.m3u8`;
    }
    if (url.includes('.mpd')) {
      return `${defaultName}.mpd`;
    }
    
    return `${defaultName}.mp4`;
  } catch (error) {
    return `${defaultName}.mp4`;
  }
}
