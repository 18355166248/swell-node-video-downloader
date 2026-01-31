import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import pLimit from 'p-limit';
import ffmpeg from 'fluent-ffmpeg';

/**
 * 下载 HLS (m3u8) 流媒体
 * 
 * @param {string} m3u8Url - m3u8 播放列表 URL
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadHLS(m3u8Url, outputPath, options = {}) {
  const {
    concurrency = 5, // 并发下载片段数
    retries = 3, // 重试次数
    tempDir = path.join(process.cwd(), 'temp')
  } = options;

  // 确保临时目录存在
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const taskId = Date.now().toString();
  const segmentDir = path.join(tempDir, `hls_${taskId}`);

  try {
    fs.mkdirSync(segmentDir, { recursive: true });

    logger.info(`下载 m3u8 文件: ${m3u8Url}`);

    // 1. 下载并解析 m3u8 文件
    const m3u8Response = await axios.get(m3u8Url);
    const m3u8Content = m3u8Response.data;

    // 解析 m3u8 内容，提取片段 URL
    const segments = parseM3U8(m3u8Content, m3u8Url);
    logger.info(`找到 ${segments.length} 个视频片段`);

    if (segments.length === 0) {
      throw new Error('未找到视频片段');
    }

    // 2. 下载所有片段
    const limit = pLimit(concurrency);
    const segmentFiles = [];

    const downloadPromises = segments.map((segmentUrl, index) =>
      limit(async () => {
        const segmentFile = path.join(segmentDir, `segment_${index.toString().padStart(6, '0')}.ts`);
        await downloadSegment(segmentUrl, segmentFile, retries);
        segmentFiles.push(segmentFile);
        logger.debug(`下载片段 ${index + 1}/${segments.length}: ${segmentUrl}`);
      })
    );

    await Promise.all(downloadPromises);
    logger.info('所有片段下载完成');

    // 3. 合并片段
    logger.info('开始合并视频片段...');
    await mergeSegments(segmentFiles, outputPath);

    // 4. 清理临时文件
    cleanupTempFiles(segmentDir);

    const stats = fs.statSync(outputPath);

    return {
      success: true,
      url: m3u8Url,
      outputPath,
      size: stats.size,
      segments: segments.length,
      message: '下载完成'
    };
  } catch (error) {
    // 清理临时文件
    cleanupTempFiles(segmentDir);
    throw error;
  }
}

/**
 * 解析 m3u8 内容，提取片段 URL
 */
function parseM3U8(content, baseUrl) {
  const segments = [];
  const lines = content.split('\n');
  const baseUrlObj = new URL(baseUrl);
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过注释和空行
    if (!line || line.startsWith('#')) {
      continue;
    }

    // 如果是 URL
    if (line.startsWith('http://') || line.startsWith('https://')) {
      segments.push(line);
    } else if (line.startsWith('/')) {
      // 绝对路径
      segments.push(`${baseUrlObj.origin}${line}`);
    } else {
      // 相对路径
      segments.push(`${basePath}${line}`);
    }
  }

  return segments;
}

/**
 * 下载单个片段
 */
async function downloadSegment(url, filePath, retries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      fs.writeFileSync(filePath, response.data);
      return;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`下载片段失败 (${retries} 次重试): ${url} - ${error.message}`);
      }
      logger.warn(`下载片段失败，重试 ${attempt}/${retries}: ${url}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * 合并视频片段
 * 使用 FFmpeg 合并，如果没有 FFmpeg 则使用简单的文件拼接
 */
async function mergeSegments(segmentFiles, outputPath) {
  try {
    // 尝试使用 FFmpeg 合并
    const ffmpegInstance = ffmpeg();

    // 创建文件列表
    const fileListPath = path.join(path.dirname(segmentFiles[0]), 'filelist.txt');
    const fileListContent = segmentFiles
      .map(file => `file '${file.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(fileListPath, fileListContent);

    await new Promise((resolve, reject) => {
      ffmpegInstance
        .input(fileListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', () => {
          fs.unlinkSync(fileListPath);
          resolve();
        })
        .on('error', (err) => {
          fs.unlinkSync(fileListPath);
          reject(err);
        })
        .run();
    });
  } catch (error) {
    logger.warn('FFmpeg 合并失败，使用文件拼接:', error.message);
    // 回退到简单的文件拼接
    await mergeSegmentsSimple(segmentFiles, outputPath);
  }
}

/**
 * 简单的文件拼接（不推荐，但作为回退方案）
 */
async function mergeSegmentsSimple(segmentFiles, outputPath) {
  const writeStream = fs.createWriteStream(outputPath);

  for (const file of segmentFiles) {
    const data = fs.readFileSync(file);
    writeStream.write(data);
  }

  writeStream.end();
  await new Promise((resolve) => writeStream.on('finish', resolve));
}

/**
 * 清理临时文件
 */
function cleanupTempFiles(dir) {
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
      fs.rmdirSync(dir);
    }
  } catch (error) {
    logger.warn('清理临时文件失败:', error.message);
  }
}
