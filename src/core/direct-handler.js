import axios from 'axios';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * 获取浏览器请求头，避免被服务器拒绝
 * @param {string} url - 请求的 URL
 * @param {object} extraHeaders - 额外的请求头
 * @returns {object} 请求头对象
 */
function getBrowserHeaders(url, extraHeaders = {}) {
  try {
    const urlObj = new URL(url);
    const referer = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': referer,
      'Origin': urlObj.origin,
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      ...extraHeaders
    };
  } catch (error) {
    // 如果 URL 解析失败，返回基本请求头
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      ...extraHeaders
    };
  }
}

/**
 * 直接下载视频文件（非流媒体）
 * 
 * @param {string} url - 视频 URL
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadDirect(url, outputPath, options = {}) {
  const retries = options.retries || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let writeStream = null;
    let response = null;
    
    try {
      if (attempt > 1) {
        logger.info(`直接下载视频 (重试 ${attempt}/${retries}): ${url}`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } else {
        logger.info(`直接下载视频: ${url}`);
      }

      response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: options.timeout || 120000,
        headers: getBrowserHeaders(url),
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      writeStream = fs.createWriteStream(outputPath);
      let downloadedBytes = 0;
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

      // 处理进度更新
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && options.onProgress) {
          const percent = (downloadedBytes / totalBytes * 100).toFixed(2);
          options.onProgress(percent, `下载中: ${percent}%`);
        } else if (options.onProgress) {
          options.onProgress(0, `已下载: ${formatBytes(downloadedBytes)}`);
        }
      });

      // 管道数据流
      response.data.pipe(writeStream);

      await new Promise((resolve, reject) => {
        let isResolved = false;
        
        const cleanup = () => {
          if (writeStream && !writeStream.destroyed) {
            try {
              writeStream.destroy();
            } catch (e) {
              // 忽略清理错误
            }
          }
          if (response && response.data) {
            try {
              response.data.destroy();
            } catch (e) {
              // 忽略清理错误
            }
          }
        };

        const resolveOnce = () => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        const rejectOnce = (err) => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            reject(err);
          }
        };

        writeStream.on('finish', resolveOnce);
        writeStream.on('close', resolveOnce);

        writeStream.on('error', (err) => {
          rejectOnce(new Error(`写入文件失败: ${err.message}`));
        });

        response.data.on('error', (err) => {
          const errorMsg = err.message || err.toString();
          if (errorMsg.includes('aborted') || errorMsg.includes('ECONNRESET')) {
            rejectOnce(new Error(`连接被重置，请重试: ${errorMsg}`));
          } else {
            rejectOnce(new Error(`下载流错误: ${errorMsg}`));
          }
        });

        response.data.on('end', () => {
          // 确保流完全结束
          setTimeout(() => {
            if (!isResolved) {
              resolveOnce();
            }
          }, 100);
        });
      });

      const stats = fs.statSync(outputPath);
      
      if (stats.size === 0) {
        throw new Error('下载的文件大小为0');
      }

      logger.info(`下载完成: ${outputPath} (${stats.size} 字节)`);

      return {
        success: true,
        url,
        outputPath,
        size: stats.size,
        method: 'direct',
        message: '下载完成'
      };
    } catch (error) {
      lastError = error;
      
      // 确保清理流
      if (writeStream && !writeStream.destroyed) {
        try {
          writeStream.destroy();
        } catch (e) {
          // 忽略清理错误
        }
      }
      
      if (response && response.data) {
        try {
          response.data.destroy();
        } catch (e) {
          // 忽略清理错误
        }
      }
      
      // 如果文件已部分下载，尝试删除
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (cleanupError) {
        logger.warn('清理部分下载文件失败:', cleanupError.message);
      }
      
      if (attempt === retries) {
        logger.error(`直接下载失败 (${retries} 次重试):`, error.message);
        throw new Error(`下载失败: ${error.message}`);
      } else {
        logger.warn(`直接下载失败，重试 ${attempt}/${retries}: ${error.message}`);
      }
    }
  }

  throw lastError || new Error('下载失败');
}

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
