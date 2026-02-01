import { EventEmitter } from 'events';
import { logger } from './logger.js';

/**
 * 任务管理器
 * 用于跟踪下载任务的状态和进度
 */
class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
  }

  /**
   * 创建新任务
   * @param {string} taskId - 任务ID
   * @param {object} taskInfo - 任务信息
   */
  createTask(taskId, taskInfo = {}) {
    const task = {
      id: taskId,
      status: 'pending', // pending, downloading, completed, failed
      progress: 0,
      message: '等待开始...',
      startTime: Date.now(),
      ...taskInfo
    };
    
    this.tasks.set(taskId, task);
    this.emit('taskCreated', task);
    logger.info(`创建任务: ${taskId}`);
    return task;
  }

  /**
   * 更新任务进度
   * @param {string} taskId - 任务ID
   * @param {number} progress - 进度百分比 (0-100)
   * @param {string} message - 状态消息
   */
  updateProgress(taskId, progress, message = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`任务不存在: ${taskId}`);
      return;
    }

    task.progress = Math.min(100, Math.max(0, progress));
    task.status = 'downloading';
    if (message) {
      task.message = message;
    }

    this.emit('progress', task);
    logger.debug(`任务 ${taskId} 进度: ${task.progress.toFixed(2)}%`);
  }

  /**
   * 完成任务
   * @param {string} taskId - 任务ID
   * @param {object} result - 任务结果
   */
  completeTask(taskId, result = {}) {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`任务不存在: ${taskId}`);
      return;
    }

    task.status = 'completed';
    task.progress = 100;
    task.message = '下载完成';
    task.endTime = Date.now();
    task.duration = task.endTime - task.startTime;
    Object.assign(task, result);

    this.emit('completed', task);
    logger.info(`任务完成: ${taskId}`);
  }

  /**
   * 任务失败
   * @param {string} taskId - 任务ID
   * @param {string} error - 错误信息
   */
  failTask(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`任务不存在: ${taskId}`);
      return;
    }

    task.status = 'failed';
    task.message = error || '下载失败';
    task.endTime = Date.now();
    task.duration = task.endTime - task.startTime;

    this.emit('failed', task);
    logger.error(`任务失败: ${taskId} - ${error}`);
  }

  /**
   * 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {object|null} 任务信息
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 删除任务
   * @param {string} taskId - 任务ID
   */
  removeTask(taskId) {
    this.tasks.delete(taskId);
    logger.info(`删除任务: ${taskId}`);
  }

  /**
   * 清理旧任务（保留最近的任务）
   * @param {number} keepCount - 保留的任务数量
   */
  cleanupOldTasks(keepCount = 100) {
    if (this.tasks.size <= keepCount) {
      return;
    }

    const tasks = Array.from(this.tasks.values());
    tasks.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    
    const toRemove = tasks.slice(keepCount);
    toRemove.forEach(task => {
      this.tasks.delete(task.id);
    });

    logger.info(`清理了 ${toRemove.length} 个旧任务`);
  }
}

// 单例模式
export const taskManager = new TaskManager();
