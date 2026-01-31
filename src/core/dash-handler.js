import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import mpdParser from 'mpd-parser';
const { MpdParser } = mpdParser;
import pLimit from 'p-limit';
import ffmpeg from 'fluent-ffmpeg';

/**
 * 下载 DASH (mpd) 流媒体
 * 
 * @param {string} mpdUrl - MPD 清单文件 URL
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadDASH(mpdUrl, outputPath, options = {}) {
  try {
    logger.info(`下载 MPD 文件: ${mpdUrl}`);

    // 1. 下载并解析 MPD 文件
    const mpdResponse = await axios.get(mpdUrl);
    const mpdContent = mpdResponse.data;

    // 解析 MPD
    const parser = new MpdParser();
    const manifest = parser.parse(mpdContent, { url: mpdUrl });

    if (!manifest || !manifest.playlists || manifest.playlists.length === 0) {
      throw new Error('MPD 清单中没有找到播放列表');
    }

    // 2. 选择最高质量的视频流
    const videoPlaylist = manifest.playlists
      .filter(pl => pl.attributes && pl.attributes.BANDWIDTH)
      .sort((a, b) => b.attributes.BANDWIDTH - a.attributes.BANDWIDTH)[0];

    if (!videoPlaylist) {
      throw new Error('未找到有效的视频流');
    }

    logger.info(`选择视频流，码率: ${videoPlaylist.attributes.BANDWIDTH} bps`);

    // 3. 提取片段 URL
    const segments = extractSegments(videoPlaylist, mpdUrl);
    logger.info(`找到 ${segments.length} 个视频片段`);

    if (segments.length === 0) {
      throw new Error('未找到视频片段');
    }

    // 4. 使用 FFmpeg 下载（推荐方式）
    try {
      return await downloadWithFFmpeg(mpdUrl, outputPath, options);
    } catch (error) {
      logger.warn('FFmpeg 下载失败，尝试手动下载片段:', error.message);
      // 回退到手动下载片段
      return await downloadSegmentsManually(segments, outputPath, options);
    }
  } catch (error) {
    logger.error('下载 DASH 流失败:', error.message);
    throw error;
  }
}

/**
 * 使用 FFmpeg 下载 DASH 流（推荐）
 */
async function downloadWithFFmpeg(mpdUrl, outputPath, options) {
  const ffmpegInstance = ffmpeg();

  return new Promise((resolve, reject) => {
    ffmpegInstance
      .input(mpdUrl)
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('start', (commandLine) => {
        logger.debug('FFmpeg 命令:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          logger.debug(`下载进度: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        const stats = fs.statSync(outputPath);
        resolve({
          success: true,
          url: mpdUrl,
          outputPath,
          size: stats.size,
          method: 'ffmpeg',
          message: '下载完成'
        });
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg 下载失败: ${err.message}`));
      })
      .run();
  });
}

/**
 * 手动下载片段（回退方案）
 */
async function downloadSegmentsManually(segments, outputPath, options) {
  const { concurrency = 5, retries = 3 } = options;
  const tempDir = path.join(process.cwd(), 'temp');
  const taskId = Date.now().toString();
  const segmentDir = path.join(tempDir, `dash_${taskId}`);

  try {
    fs.mkdirSync(segmentDir, { recursive: true });

    const limit = pLimit(concurrency);
    const segmentFiles = [];

    const downloadPromises = segments.map((segmentUrl, index) =>
      limit(async () => {
        const segmentFile = path.join(segmentDir, `segment_${index.toString().padStart(6, '0')}.mp4`);
        await downloadSegment(segmentUrl, segmentFile, retries);
        segmentFiles.push(segmentFile);
      })
    );

    await Promise.all(downloadPromises);

    // 合并片段
    await mergeSegments(segmentFiles, outputPath);

    // 清理临时文件
    cleanupTempFiles(segmentDir);

    const stats = fs.statSync(outputPath);

    return {
      success: true,
      url: segments[0],
      outputPath,
      size: stats.size,
      segments: segments.length,
      method: 'manual',
      message: '下载完成'
    };
  } catch (error) {
    cleanupTempFiles(segmentDir);
    throw error;
  }
}

/**
 * 从播放列表中提取片段 URL
 */
function extractSegments(playlist, baseUrl) {
  const segments = [];
  const baseUrlObj = new URL(baseUrl);
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

  // 这里需要根据实际的 MPD 结构来提取片段
  // 简化版本，实际需要处理 SegmentTemplate、SegmentList 等
  if (playlist.segments) {
    for (const segment of playlist.segments) {
      if (segment.uri) {
        if (segment.uri.startsWith('http://') || segment.uri.startsWith('https://')) {
          segments.push(segment.uri);
        } else if (segment.uri.startsWith('/')) {
          segments.push(`${baseUrlObj.origin}${segment.uri}`);
        } else {
          segments.push(`${basePath}${segment.uri}`);
        }
      }
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
        throw new Error(`下载片段失败: ${url}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * 合并片段
 */
async function mergeSegments(segmentFiles, outputPath) {
  try {
    const fileListPath = path.join(path.dirname(segmentFiles[0]), 'filelist.txt');
    const fileListContent = segmentFiles
      .map(file => `file '${file.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(fileListPath, fileListContent);

    const ffmpegInstance = ffmpeg();

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
        .on('error', reject)
        .run();
    });
  } catch (error) {
    // 回退到简单拼接
    const writeStream = fs.createWriteStream(outputPath);
    for (const file of segmentFiles) {
      const data = fs.readFileSync(file);
      writeStream.write(data);
    }
    writeStream.end();
    await new Promise((resolve) => writeStream.on('finish', resolve));
  }
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
    // 忽略清理错误
  }
}
