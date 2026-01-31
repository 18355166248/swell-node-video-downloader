import { downloadHLS } from './hls-handler.js';
import { downloadDASH } from './dash-handler.js';
import { downloadDirect } from './direct-handler.js';
import { isHLS, isDASH, extractFilename } from '../utils/videoUtils.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

/**
 * 下载视频的主入口
 * 根据视频类型自动选择下载方式
 * 
 * @param {string} url - 视频 URL
 * @param {string} outputPath - 输出路径（可选）
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadVideo(url, outputPath = null, options = {}) {
  try {
    // 如果没有指定输出路径，使用默认路径
    if (!outputPath) {
      const downloadsDir = path.join(process.cwd(), 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      const filename = extractFilename(url);
      outputPath = path.join(downloadsDir, filename);
    }

    logger.info(`开始下载视频: ${url}`);
    logger.info(`输出路径: ${outputPath}`);

    // 根据视频类型选择下载方式
    if (isHLS(url)) {
      logger.info('检测到 HLS 流，使用 HLS 下载器');
      return await downloadHLS(url, outputPath, options);
    }

    if (isDASH(url)) {
      logger.info('检测到 DASH 流，使用 DASH 下载器');
      return await downloadDASH(url, outputPath, options);
    }

    // 直接下载
    logger.info('使用直接下载方式');
    return await downloadDirect(url, outputPath, options);
  } catch (error) {
    logger.error('下载视频失败:', error.message);
    throw error;
  }
}
