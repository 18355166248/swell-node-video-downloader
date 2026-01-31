import express from 'express';
import { detectVideoUrl } from '../core/detector.js';
import { downloadVideo } from '../core/downloader.js';
import { logger } from '../utils/logger.js';

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

    logger.info(`检测视频 URL: ${url}${buttonSelector ? `，按钮选择器: ${buttonSelector}` : ''}`);
    
    const options = {};
    if (buttonSelector) options.buttonSelector = buttonSelector;
    if (clickWaitTime) options.clickWaitTime = clickWaitTime;
    if (headless !== undefined) options.headless = headless;
    if (timeout) options.timeout = timeout;

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
 * 下载视频
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

    logger.info(`开始下载视频: ${url}`);
    const result = await downloadVideo(url, outputPath, options);

    res.json({
      success: true,
      data: result
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
    // TODO: 实现任务状态查询
    res.json({
      success: true,
      data: {
        taskId,
        status: 'pending',
        message: '功能待实现'
      }
    });
  } catch (error) {
    next(error);
  }
});
