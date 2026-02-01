import express from 'express';
import { detectVideoUrl } from '../core/detector.js';
import { downloadVideo } from '../core/downloader.js';
import { downloadHLSFromFile } from '../core/hls-handler.js';
import { taskManager } from '../utils/taskManager.js';
import { continuousDetector } from '../utils/continuousDetector.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

export const videoRouter = express.Router();

/**
 * POST /api/video/detect
 * 检测页面中的视频 URL
 * 
 * 请求体参数:
 * - url: 要检测的页面 URL（必需）
 * - buttonSelector: 需要点击的按钮选择器（可选），点击后会触发新视频下载
 * - clickWaitTime: 点击按钮后等待时间，毫秒（可选，默认3000）
 * - headless: 是否使用无头模式（可选，默认true）
 * - timeout: 超时时间，毫秒（可选，默认30000）
 */
videoRouter.post('/detect', async (req, res, next) => {
  try {
    const { url, buttonSelector, clickWaitTime, headless, timeout } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 url 参数' }
      });
    }

    logger.info(`检测视频 URL: ${url}${buttonSelector ? `，按钮选择器: ${buttonSelector}` : ''}${timeout ? `，超时时间: ${timeout}ms` : ''}`);
    
    const options = {};
    if (buttonSelector) options.buttonSelector = buttonSelector;
    if (clickWaitTime) options.clickWaitTime = clickWaitTime;
    if (headless !== undefined) options.headless = headless;
    // timeout 支持配置，如果没有提供则使用默认值（detector.js 中的默认值 30000）
    if (timeout !== undefined && timeout !== null) {
      options.timeout = parseInt(timeout, 10);
      if (isNaN(options.timeout) || options.timeout < 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'timeout 必须是大于等于 0 的数字' }
        });
      }
    }

    const videoUrls = await detectVideoUrl(url, options);

    res.json({
      success: true,
      data: {
        url,
        videoUrls,
        count: videoUrls.length
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/video/download
 * 下载视频（异步，返回任务ID）
 */
videoRouter.post('/download', async (req, res, next) => {
  try {
    const { url, outputPath, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 url 参数' }
      });
    }

    // 生成任务ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 创建任务
    taskManager.createTask(taskId, {
      url,
      outputPath,
      options
    });

    // 异步执行下载任务
    downloadVideo(url, outputPath, {
      ...options,
      onProgress: (progress, message) => {
        taskManager.updateProgress(taskId, progress, message);
      }
    })
      .then(result => {
        taskManager.completeTask(taskId, result);
      })
      .catch(error => {
        taskManager.failTask(taskId, error.message);
      });

    // 立即返回任务ID
    res.json({
      success: true,
      data: {
        taskId,
        message: '下载任务已创建'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/video/status/:taskId
 * 查询下载任务状态
 */
videoRouter.get('/status/:taskId', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const task = taskManager.getTask(taskId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: { message: '任务不存在' }
      });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/video/progress/:taskId
 * SSE 端点：实时推送下载进度
 */
videoRouter.get('/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  // 发送初始连接消息
  res.write(`data: ${JSON.stringify({ type: 'connected', taskId })}\n\n`);

  // 立即发送当前任务状态
  const currentTask = taskManager.getTask(taskId);
  if (currentTask) {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...currentTask })}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ type: 'error', message: '任务不存在' })}\n\n`);
    res.end();
    return;
  }

  // 监听任务进度更新
  const onProgress = (task) => {
    if (task.id === taskId) {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...task })}\n\n`);
    }
  };

  const onCompleted = (task) => {
    if (task.id === taskId) {
      res.write(`data: ${JSON.stringify({ type: 'completed', ...task })}\n\n`);
      res.end();
      cleanup();
    }
  };

  const onFailed = (task) => {
    if (task.id === taskId) {
      res.write(`data: ${JSON.stringify({ type: 'failed', ...task })}\n\n`);
      res.end();
      cleanup();
    }
  };

  const cleanup = () => {
    taskManager.removeListener('progress', onProgress);
    taskManager.removeListener('completed', onCompleted);
    taskManager.removeListener('failed', onFailed);
  };

  taskManager.on('progress', onProgress);
  taskManager.on('completed', onCompleted);
  taskManager.on('failed', onFailed);

  // 客户端断开连接时清理
  req.on('close', () => {
    cleanup();
  });
});

/**
 * POST /api/video/detect/continuous/start
 * 启动持续检测（浏览器保持打开，持续监听新视频）
 */
videoRouter.post('/detect/continuous/start', async (req, res, next) => {
  try {
    const { url, headless, timeout } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 url 参数' }
      });
    }

    // 生成会话ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`启动持续检测: ${sessionId}, URL: ${url}`);

    const options = {};
    if (headless !== undefined) options.headless = headless;
    if (timeout !== undefined && timeout !== null) {
      options.timeout = parseInt(timeout, 10);
      if (isNaN(options.timeout) || options.timeout < 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'timeout 必须是大于等于 0 的数字' }
        });
      }
    }

    const result = await continuousDetector.startDetection(sessionId, url, options);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/video/detect/continuous/stop
 * 停止持续检测
 */
videoRouter.post('/detect/continuous/stop', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 sessionId 参数' }
      });
    }

    logger.info(`停止持续检测: ${sessionId}`);

    const result = await continuousDetector.stopDetection(sessionId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/video/detect/continuous/status/:sessionId
 * 查询持续检测状态
 */
videoRouter.get('/detect/continuous/status/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const status = continuousDetector.getDetectorStatus(sessionId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: { message: '检测会话不存在' }
      });
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/video/detect/continuous/events/:sessionId
 * SSE 端点：实时推送新发现的视频
 */
videoRouter.get('/detect/continuous/events/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  // 发送初始连接消息
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // 检查检测器是否存在
  const status = continuousDetector.getDetectorStatus(sessionId);
  if (!status) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: '检测会话不存在' })}\n\n`);
    res.end();
    return;
  }

  // 发送初始状态
  res.write(`data: ${JSON.stringify({ type: 'status', ...status })}\n\n`);

  // 监听新视频事件
  const onNewVideo = (data) => {
    if (data.sessionId === sessionId) {
      res.write(`data: ${JSON.stringify({ type: 'newVideo', video: data.video })}\n\n`);
    }
  };

  const onStarted = (data) => {
    if (data.sessionId === sessionId) {
      res.write(`data: ${JSON.stringify({ type: 'started', initialVideos: data.initialVideos })}\n\n`);
    }
  };

  const onStopped = (data) => {
    if (data.sessionId === sessionId) {
      res.write(`data: ${JSON.stringify({ type: 'stopped', finalVideos: data.finalVideos })}\n\n`);
      res.end();
      cleanup();
    }
  };

  const cleanup = () => {
    continuousDetector.removeListener('newVideo', onNewVideo);
    continuousDetector.removeListener('started', onStarted);
    continuousDetector.removeListener('stopped', onStopped);
  };

  continuousDetector.on('newVideo', onNewVideo);
  continuousDetector.on('started', onStarted);
  continuousDetector.on('stopped', onStopped);

  // 客户端断开连接时清理
  req.on('close', () => {
    cleanup();
  });
});

/**
 * POST /api/video/download/m3u8
 * 从本地 m3u8 文件下载并合成视频（异步，返回任务ID）
 */
videoRouter.post('/download/m3u8', async (req, res, next) => {
  try {
    const { m3u8FilePath, outputPath, options = {} } = req.body;

    if (!m3u8FilePath) {
      return res.status(400).json({
        success: false,
        error: { message: '缺少 m3u8FilePath 参数' }
      });
    }

    // 检查文件是否存在
    const resolvedPath = path.isAbsolute(m3u8FilePath) 
      ? m3u8FilePath 
      : path.join(process.cwd(), m3u8FilePath);
    
    if (!fs.existsSync(resolvedPath)) {
      return res.status(400).json({
        success: false,
        error: { message: `m3u8 文件不存在: ${resolvedPath}` }
      });
    }

    // 如果没有指定输出路径，使用默认路径
    let finalOutputPath = outputPath;
    if (!finalOutputPath) {
      const downloadsDir = path.join(process.cwd(), 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      const filename = path.basename(resolvedPath, '.m3u8') + '.mp4';
      finalOutputPath = path.join(downloadsDir, filename);
    }

    // 生成任务ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 创建任务
    taskManager.createTask(taskId, {
      m3u8FilePath: resolvedPath,
      outputPath: finalOutputPath,
      options
    });

    logger.info(`开始处理 m3u8 文件: ${resolvedPath}`);

    // 异步执行下载任务
    downloadHLSFromFile(resolvedPath, finalOutputPath, {
      ...options,
      onProgress: (progress, message) => {
        taskManager.updateProgress(taskId, progress, message);
      }
    })
      .then(result => {
        taskManager.completeTask(taskId, result);
      })
      .catch(error => {
        taskManager.failTask(taskId, error.message);
      });

    // 立即返回任务ID
    res.json({
      success: true,
      data: {
        taskId,
        m3u8FilePath: resolvedPath,
        outputPath: finalOutputPath,
        message: 'm3u8 下载任务已创建'
      }
    });
  } catch (error) {
    next(error);
  }
});
