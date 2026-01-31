import axios from 'axios';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/**
 * 直接下载视频文件（非流媒体）
 * 
 * @param {string} url - 视频 URL
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadDirect(url, outputPath, options = {}) {
  try {
    logger.info(`直接下载视频: ${url}`);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: options.timeout || 60000
    });

    const writeStream = fs.createWriteStream(outputPath);
    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0 && options.onProgress) {
        const percent = (downloadedBytes / totalBytes * 100).toFixed(2);
        options.onProgress(percent, downloadedBytes, totalBytes);
      }
    });

    response.data.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      response.data.on('error', reject);
    });

    const stats = fs.statSync(outputPath);

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
    logger.error('直接下载失败:', error.message);
    throw new Error(`下载失败: ${error.message}`);
  }
}
