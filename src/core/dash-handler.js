import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import mpdParser from "mpd-parser";
const { MpdParser } = mpdParser;
import pLimit from "p-limit";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
 * 下载 DASH (mpd) 流媒体
 *
 * @param {string} mpdUrl - MPD 清单文件 URL
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadDASH(mpdUrl, outputPath, options = {}) {
  const { onProgress = null } = options;

  try {
    logger.info(`下载 MPD 文件: ${mpdUrl}`);

    // 更新进度：开始下载MPD文件
    if (onProgress) {
      onProgress(5, "正在下载 MPD 文件...");
    }

    // 1. 下载并解析 MPD 文件
    let mpdResponse;
    const mpdRetries = 3;
    let mpdLastError = null;
    
    for (let attempt = 1; attempt <= mpdRetries; attempt++) {
      try {
        if (attempt > 1) {
          logger.info(`下载 MPD 文件 (重试 ${attempt}/${mpdRetries}): ${mpdUrl}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
        
        mpdResponse = await axios.get(mpdUrl, {
          headers: getBrowserHeaders(mpdUrl),
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500
        });
        
        if (mpdResponse.status >= 400) {
          throw new Error(`HTTP ${mpdResponse.status}: ${mpdResponse.statusText}`);
        }
        
        break; // 成功，退出重试循环
      } catch (error) {
        mpdLastError = error;
        const errorMsg = error.message || error.toString();
        
        if (attempt === mpdRetries) {
          logger.error(`下载 MPD 文件失败 (${mpdRetries} 次重试): ${errorMsg}`);
          throw new Error(`下载 MPD 文件失败: ${errorMsg}`);
        } else {
          logger.warn(`下载 MPD 文件失败，重试 ${attempt}/${mpdRetries}: ${errorMsg}`);
        }
      }
    }
    const mpdContent = mpdResponse.data;

    // 解析 MPD
    const parser = new MpdParser();
    const manifest = parser.parse(mpdContent, { url: mpdUrl });

    if (!manifest || !manifest.playlists || manifest.playlists.length === 0) {
      throw new Error("MPD 清单中没有找到播放列表");
    }

    // 2. 选择最高质量的视频流
    const videoPlaylist = manifest.playlists
      .filter((pl) => pl.attributes && pl.attributes.BANDWIDTH)
      .sort((a, b) => b.attributes.BANDWIDTH - a.attributes.BANDWIDTH)[0];

    if (!videoPlaylist) {
      throw new Error("未找到有效的视频流");
    }

    logger.info(`选择视频流，码率: ${videoPlaylist.attributes.BANDWIDTH} bps`);

    // 3. 提取片段 URL
    const segments = extractSegments(videoPlaylist, mpdUrl);
    logger.info(`找到 ${segments.length} 个视频片段`);

    if (segments.length === 0) {
      throw new Error("未找到视频片段");
    }

    // 更新进度：开始下载
    if (onProgress) {
      onProgress(10, `找到 ${segments.length} 个片段，开始下载...`);
    }

    // 4. 下载片段并合并
    return await downloadSegmentsAndMerge(segments, mpdUrl, outputPath, options);
  } catch (error) {
    logger.error("下载 DASH 流失败:", error.message);
    throw error;
  }
}

/**
 * 下载片段并合并
 */
async function downloadSegmentsAndMerge(segments, mpdUrl, outputPath, options) {
  const {
    concurrency = 5,
    retries = 3,
    tempDir = path.join(process.cwd(), "temp"),
    onProgress = null,
  } = options;

  // 确保临时目录存在
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const taskId = Date.now().toString();
  const segmentDir = path.join(tempDir, `dash_${taskId}`);

  try {
    fs.mkdirSync(segmentDir, { recursive: true });

    // 更新进度：开始下载片段
    if (onProgress) {
      onProgress(15, "开始下载片段...");
    }

    // 下载所有片段
    const limit = pLimit(concurrency);
    const segmentFiles = [];
    const segmentInfo = []; // 存储片段信息：{ index, url, filePath, success }
    let downloadedCount = 0;
    const totalSegments = segments.length;
    const downloadProgressStart = 15;
    const downloadProgressEnd = 80;

    // 第一轮下载：捕获所有错误，不中断整个流程
    const downloadPromises = segments.map((segmentUrl, index) =>
      limit(async () => {
        const segmentFile = path.join(
          segmentDir,
          `segment_${index.toString().padStart(6, "0")}.mp4`
        );
        
        const segmentInfoItem = {
          index,
          url: segmentUrl,
          filePath: segmentFile,
          success: false
        };
        segmentInfo.push(segmentInfoItem);

        try {
          await downloadSegment(segmentUrl, segmentFile, retries);
          
          // 验证文件是否存在且大小大于0
          if (fs.existsSync(segmentFile)) {
            const stats = fs.statSync(segmentFile);
            if (stats.size > 0) {
              segmentInfoItem.success = true;
              segmentFiles.push(segmentFile);
              downloadedCount++;
            } else {
              logger.warn(`片段文件大小为0: ${segmentFile}`);
              // 删除空文件
              try {
                fs.unlinkSync(segmentFile);
              } catch (e) {
                // 忽略删除错误
              }
            }
          }
        } catch (error) {
          logger.error(`下载片段失败 [${index + 1}/${totalSegments}]: ${segmentUrl} - ${error.message}`);
          segmentInfoItem.error = error.message;
        }

        // 更新进度
        if (onProgress) {
          const segmentProgress =
            downloadProgressStart +
            (downloadedCount / totalSegments) *
              (downloadProgressEnd - downloadProgressStart);
          onProgress(
            segmentProgress,
            `已下载 ${downloadedCount}/${totalSegments} 个片段`
          );
        }

        if (segmentInfoItem.success) {
          logger.debug(`下载片段 ${index + 1}/${segments.length}: ${segmentUrl}`);
        }
      })
    );

    await Promise.all(downloadPromises);
    
    // 检查失败的片段
    const failedSegments = segmentInfo.filter(item => !item.success);
    
    if (failedSegments.length > 0) {
      logger.warn(`发现 ${failedSegments.length} 个片段下载失败，开始补齐...`);
      
      if (onProgress) {
        onProgress(
          downloadProgressEnd - 5,
          `发现 ${failedSegments.length} 个片段失败，正在补齐...`
        );
      }

      // 补齐失败的片段（使用更高的重试次数）
      const retryLimit = pLimit(Math.min(concurrency, failedSegments.length));
      
      const retryPromises = failedSegments.map((item) =>
        retryLimit(async () => {
          try {
            logger.info(`补齐片段 [${item.index + 1}/${totalSegments}]: ${item.url}`);
            await downloadSegment(item.url, item.filePath, retries * 2); // 使用双倍重试次数
            
            // 验证文件是否存在且大小大于0
            if (fs.existsSync(item.filePath)) {
              const stats = fs.statSync(item.filePath);
              if (stats.size > 0) {
                item.success = true;
                segmentFiles.push(item.filePath);
                downloadedCount++;
                logger.info(`补齐成功 [${item.index + 1}/${totalSegments}]: ${item.url}`);
              } else {
                logger.warn(`补齐后片段文件大小仍为0: ${item.filePath}`);
                try {
                  fs.unlinkSync(item.filePath);
                } catch (e) {
                  // 忽略删除错误
                }
              }
            }
          } catch (error) {
            logger.error(`补齐片段失败 [${item.index + 1}/${totalSegments}]: ${item.url} - ${error.message}`);
            item.error = error.message;
          }
          
          // 更新进度
          if (onProgress) {
            const segmentProgress =
              downloadProgressStart +
              (downloadedCount / totalSegments) *
                (downloadProgressEnd - downloadProgressStart);
            onProgress(
              segmentProgress,
              `已下载 ${downloadedCount}/${totalSegments} 个片段 (补齐中...)`
            );
          }
        })
      );

      await Promise.all(retryPromises);
      
      // 检查补齐后的结果
      const stillFailed = segmentInfo.filter(item => !item.success);
      if (stillFailed.length > 0) {
        logger.warn(`仍有 ${stillFailed.length} 个片段无法下载:`);
        stillFailed.forEach(item => {
          logger.warn(`  - 片段 [${item.index + 1}]: ${item.url} - ${item.error || '未知错误'}`);
        });
        logger.warn(`将继续合并已成功下载的 ${downloadedCount}/${totalSegments} 个片段`);
      } else {
        logger.info(`所有片段补齐成功！`);
      }
    }

    // 按索引排序片段文件，确保顺序正确
    segmentFiles.sort((a, b) => {
      const indexA = parseInt(path.basename(a).match(/\d+/)[0]);
      const indexB = parseInt(path.basename(b).match(/\d+/)[0]);
      return indexA - indexB;
    });

    logger.info(`片段下载完成: 成功 ${downloadedCount}/${totalSegments} 个`);

    // 更新进度：开始合并
    if (onProgress) {
      onProgress(80, "正在合并视频片段...");
    }

    // 合并片段
    logger.info("开始合并视频片段...");
    const finalOutputPath = await mergeSegments(segmentFiles, outputPath);

    // 更新进度：合并完成
    if (onProgress) {
      onProgress(95, "合并完成，正在清理临时文件...");
    }

    // 清理临时文件
    cleanupTempFiles(segmentDir);

    const stats = fs.statSync(finalOutputPath);

    // 更新进度：完成
    if (onProgress) {
      onProgress(100, "下载完成");
    }

    return {
      success: true,
      url: mpdUrl,
      outputPath: finalOutputPath,
      size: stats.size,
      method: "windows-merge",
      message: "下载完成",
    };
  } catch (error) {
    // 清理临时文件
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
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

  // 这里需要根据实际的 MPD 结构来提取片段
  // 简化版本，实际需要处理 SegmentTemplate、SegmentList 等
  if (playlist.segments) {
    for (const segment of playlist.segments) {
      if (segment.uri) {
        if (
          segment.uri.startsWith("http://") ||
          segment.uri.startsWith("https://")
        ) {
          segments.push(segment.uri);
        } else if (segment.uri.startsWith("/")) {
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
        responseType: "arraybuffer",
        timeout: 60000,
        headers: getBrowserHeaders(url),
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.data || response.data.length === 0) {
        throw new Error('下载的片段数据为空');
      }

      fs.writeFileSync(filePath, response.data);
      return;
    } catch (error) {
      const errorMsg = error.message || error.toString();
      
      if (attempt === retries) {
        throw new Error(`下载片段失败 (${retries} 次重试): ${url} - ${errorMsg}`);
      }
      
      logger.warn(`下载片段失败，重试 ${attempt}/${retries}: ${url} - ${errorMsg}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * 合并片段
 * 使用 Node.js fs 模块合并，避免 Windows copy 命令参数长度限制
 */
async function mergeSegments(segmentFiles, outputPath) {
  try {
    logger.debug(`开始合并 ${segmentFiles.length} 个片段到: ${outputPath}`);
    
    // 使用 Node.js fs 模块合并文件，避免命令行参数长度限制
    const writeStream = fs.createWriteStream(outputPath);
    
    // 按顺序合并每个片段文件
    for (let i = 0; i < segmentFiles.length; i++) {
      const segmentFile = segmentFiles[i];
      
      // 检查文件是否存在
      if (!fs.existsSync(segmentFile)) {
        throw new Error(`片段文件不存在: ${segmentFile}`);
      }
      
      // 读取并追加到输出文件
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(segmentFile);
        
        readStream.on('error', (err) => {
          writeStream.destroy();
          reject(new Error(`读取片段文件失败 ${segmentFile}: ${err.message}`));
        });
        
        readStream.on('end', () => {
          resolve();
        });
        
        readStream.pipe(writeStream, { end: false });
      });
      
      // 每合并 50 个片段输出一次进度
      if ((i + 1) % 50 === 0 || i === segmentFiles.length - 1) {
        logger.debug(`已合并 ${i + 1}/${segmentFiles.length} 个片段`);
      }
    }
    
    // 关闭写入流
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });
    
    // 验证输出文件是否存在
    if (!fs.existsSync(outputPath)) {
      throw new Error("合并后的文件不存在");
    }
    
    // 确保文件扩展名为 .mp4，以便播放器可以正常打开
    const ext = path.extname(outputPath).toLowerCase();
    let finalOutputPath = outputPath;
    
    if (ext !== '.mp4') {
      finalOutputPath = outputPath.replace(/\.[^.]+$/, '') + '.mp4';
      if (finalOutputPath !== outputPath) {
        fs.renameSync(outputPath, finalOutputPath);
        logger.debug(`文件已重命名为: ${finalOutputPath}`);
      }
    }
    
    const stats = fs.statSync(finalOutputPath);
    logger.info(`合并完成: ${finalOutputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // 返回最终的文件路径
    return finalOutputPath;
  } catch (error) {
    throw new Error(`合并失败: ${error.message}`);
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
