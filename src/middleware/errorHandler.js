import { logger } from '../utils/logger.js';

/**
 * 全局错误处理中间件
 */
export const errorHandler = (err, req, res, next) => {
  logger.error('错误:', err.message);
  logger.debug('错误堆栈:', err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.DEBUG === 'true' && { stack: err.stack })
    }
  });
};
