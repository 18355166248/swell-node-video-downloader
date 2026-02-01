import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
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
 * 从本地文件下载 HLS (m3u8) 流媒体
 *
 * @param {string} m3u8FilePath - m3u8 文件本地路径
 * @param {string} outputPath - 输出文件路径
 * @param {object} options - 选项
 * @returns {Promise<object>} 下载结果
 */
export async function downloadHLSFromFile(m3u8FilePath, outputPath, options = {}) {
  const {
    concurrency = 5,
    retries = 3,
    tempDir = path.join(process.cwd(), "temp"),
    onProgress = null,
    baseUrl = null, // 如果片段是 URL，可以指定基础 URL
  } = options;

  // 确保临时目录存在
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const taskId = Date.now().toString();
  const segmentDir = path.join(tempDir, `hls_${taskId}`);

  try {
    // 检查 m3u8 文件是否存在
    if (!fs.existsSync(m3u8FilePath)) {
      throw new Error(`m3u8 文件不存在: ${m3u8FilePath}`);
    }

    fs.mkdirSync(segmentDir, { recursive: true });

    logger.info(`读取本地 m3u8 文件: ${m3u8FilePath}`);

    // 更新进度：开始读取 m3u8 文件
    if (onProgress) {
      onProgress(5, "正在读取 m3u8 文件...");
    }

    // 1. 读取本地 m3u8 文件
    const m3u8Content = fs.readFileSync(m3u8FilePath, "utf-8");
    
    // 获取 m3u8 文件所在目录，用于解析相对路径的片段
    const m3u8Dir = path.dirname(path.resolve(m3u8FilePath));
    
    // 解析 m3u8 内容，提取片段路径
    const segments = parseM3U8FromFile(m3u8Content, m3u8Dir, baseUrl);
    logger.info(`找到 ${segments.length} 个视频片段`);

    if (segments.length === 0) {
      throw new Error("未找到视频片段");
    }

    // 更新进度：开始下载片段
    if (onProgress) {
      onProgress(10, `找到 ${segments.length} 个片段，开始下载...`);
    }

    // 2. 下载所有片段
    const limit = pLimit(concurrency);
    const segmentFiles = [];
    let downloadedCount = 0;
    const totalSegments = segments.length;
    const downloadProgressStart = 10;
    const downloadProgressEnd = 80;

    const downloadPromises = segments.map((segmentPath, index) =>
      limit(async () => {
        const segmentFile = path.join(
          segmentDir,
          `segment_${index.toString().padStart(6, "0")}.ts`
        );
        await downloadSegmentFromFile(segmentPath, segmentFile, retries);
        segmentFiles.push(segmentFile);
        downloadedCount++;

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

        logger.debug(`下载片段 ${index + 1}/${segments.length}: ${segmentPath}`);
      })
    );

    await Promise.all(downloadPromises);
    logger.info("所有片段下载完成");

    // 更新进度：开始合并
    if (onProgress) {
      onProgress(80, "正在合并视频片段...");
    }

    // 3. 合并片段
    logger.info("开始合并视频片段...");
    const finalOutputPath = await mergeSegments(segmentFiles, outputPath);

    // 更新进度：合并完成
    if (onProgress) {
      onProgress(95, "合并完成，正在清理临时文件...");
    }

    // 4. 清理临时文件
    cleanupTempFiles(segmentDir);

    const stats = fs.statSync(finalOutputPath);

    // 更新进度：完成
    if (onProgress) {
      onProgress(100, "下载完成");
    }

    return {
      success: true,
      file: m3u8FilePath,
      outputPath: finalOutputPath,
      size: stats.size,
      segments: segments.length,
      message: "下载完成",
    };
  } catch (error) {
    // 清理临时文件
    cleanupTempFiles(segmentDir);
    throw error;
  }
}

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
    tempDir = path.join(process.cwd(), "temp"),
    onProgress = null, // 进度回调函数
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

    // 更新进度：开始下载m3u8文件
    console.log("🚀 ~ downloadHLS ~ onProgress:", onProgress)
    if (onProgress) {
      onProgress(5, "正在下载 m3u8 文件...");
    }

    // 1. 下载并解析 m3u8 文件
    let m3u8Response;
    const m3u8Retries = 3;
    let m3u8LastError = null;
    
    for (let attempt = 1; attempt <= m3u8Retries; attempt++) {
      try {
        if (attempt > 1) {
          logger.info(`下载 m3u8 文件 (重试 ${attempt}/${m3u8Retries}): ${m3u8Url}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
        
        m3u8Response = await axios.get(m3u8Url, {
          headers: getBrowserHeaders(m3u8Url),
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500
        });
        
        if (m3u8Response.status >= 400) {
          throw new Error(`HTTP ${m3u8Response.status}: ${m3u8Response.statusText}`);
        }
        
        break; // 成功，退出重试循环
      } catch (error) {
        m3u8LastError = error;
        const errorMsg = error.message || error.toString();
        
        if (attempt === m3u8Retries) {
          logger.error(`下载 m3u8 文件失败 (${m3u8Retries} 次重试): ${errorMsg}`);
          throw new Error(`下载 m3u8 文件失败: ${errorMsg}`);
        } else {
          logger.warn(`下载 m3u8 文件失败，重试 ${attempt}/${m3u8Retries}: ${errorMsg}`);
        }
      }
    }
    const m3u8Content = m3u8Response.data;

    // 解析 m3u8 内容，提取片段 URL
    const segments = parseM3U8(m3u8Content, m3u8Url);
    logger.info(`找到 ${segments.length} 个视频片段`);

    if (segments.length === 0) {
      throw new Error("未找到视频片段");
    }

    // 更新进度：开始下载片段
    if (onProgress) {
      onProgress(10, `找到 ${segments.length} 个片段，开始下载...`);
    }

    // 2. 下载所有片段
    const limit = pLimit(concurrency);
    const segmentFiles = [];
    let downloadedCount = 0;
    const totalSegments = segments.length;
    const downloadProgressStart = 10; // 下载片段进度起始百分比
    const downloadProgressEnd = 80; // 下载片段进度结束百分比

    const downloadPromises = segments.map((segmentUrl, index) =>
      limit(async () => {
        const segmentFile = path.join(
          segmentDir,
          `segment_${index.toString().padStart(6, "0")}.ts`
        );
        await downloadSegment(segmentUrl, segmentFile, retries);
        segmentFiles.push(segmentFile);
        downloadedCount++;

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

        logger.debug(`下载片段 ${index + 1}/${segments.length}: ${segmentUrl}`);
      })
    );

    await Promise.all(downloadPromises);
    logger.info("所有片段下载完成");

    // 更新进度：开始合并
    if (onProgress) {
      onProgress(80, "正在合并视频片段...");
    }

    // 3. 合并片段
    logger.info("开始合并视频片段...");
    const finalOutputPath = await mergeSegments(segmentFiles, outputPath);

    // 更新进度：合并完成
    if (onProgress) {
      onProgress(95, "合并完成，正在清理临时文件...");
    }

    // 4. 清理临时文件
    cleanupTempFiles(segmentDir);

    const stats = fs.statSync(finalOutputPath);

    // 更新进度：完成
    if (onProgress) {
      onProgress(100, "下载完成");
    }

    return {
      success: true,
      url: m3u8Url,
      outputPath: finalOutputPath,
      size: stats.size,
      segments: segments.length,
      message: "下载完成",
    };
  } catch (error) {
    // 清理临时文件
    cleanupTempFiles(segmentDir);
    throw error;
  }
}

/**
 * 解析 m3u8 内容，提取片段 URL（从 URL）
 */
function parseM3U8(content, baseUrl) {
  const segments = [];
  const lines = content.split("\n");
  const baseUrlObj = new URL(baseUrl);
  const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过注释和空行
    if (!line || line.startsWith("#")) {
      continue;
    }

    // 如果是 URL
    if (line.startsWith("http://") || line.startsWith("https://")) {
      segments.push(line);
    } else if (line.startsWith("/")) {
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
 * 解析 m3u8 内容，提取片段路径（从本地文件）
 */
function parseM3U8FromFile(content, m3u8Dir, baseUrl = null) {
  const segments = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过注释和空行
    if (!line || line.startsWith("#")) {
      continue;
    }

    // 如果是完整的 URL
    if (line.startsWith("http://") || line.startsWith("https://")) {
      segments.push(line);
    } else if (baseUrl) {
      // 如果提供了 baseUrl，将相对路径转换为完整 URL
      const baseUrlObj = new URL(baseUrl);
      const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
      
      if (line.startsWith("/")) {
        segments.push(`${baseUrlObj.origin}${line}`);
      } else {
        segments.push(`${basePath}${line}`);
      }
    } else {
      // 本地文件路径：相对路径转换为绝对路径
      const segmentPath = path.isAbsolute(line) 
        ? line 
        : path.join(m3u8Dir, line);
      segments.push(segmentPath);
    }
  }

  return segments;
}

/**
 * 下载单个片段（从 URL）
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
        throw new Error(
          `下载片段失败 (${retries} 次重试): ${url} - ${errorMsg}`
        );
      }
      
      logger.warn(`下载片段失败，重试 ${attempt}/${retries}: ${url} - ${errorMsg}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * 下载单个片段（从本地文件或 URL）
 */
async function downloadSegmentFromFile(segmentPath, filePath, retries) {
  // 如果是 URL，使用 HTTP 下载
  if (segmentPath.startsWith("http://") || segmentPath.startsWith("https://")) {
    return await downloadSegment(segmentPath, filePath, retries);
  }

  // 如果是本地文件，直接复制
  if (!fs.existsSync(segmentPath)) {
    throw new Error(`片段文件不存在: ${segmentPath}`);
  }

  // 复制文件
  fs.copyFileSync(segmentPath, filePath);
  logger.debug(`复制本地片段: ${segmentPath} -> ${filePath}`);
}

/**
 * 合并视频片段
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
    logger.warn("清理临时文件失败:", error.message);
  }
}
