import { useState } from 'react';
import * as React from 'react';
import './App.css';

const API_BASE = '/api/video';

interface VideoInfo {
  url: string;
  contentType?: string | null;
  size?: number | null;
  formattedSize?: string | null;
}

interface DownloadProgress {
  taskId: string;
  videoUrl: string;
  progress: number;
  message: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
}

function App() {
  const [videoUrl, setVideoUrl] = useState('https://missav.ws/dm18/dandy-714#00:00:02');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<VideoInfo[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map());
  
  // 持续检测状态
  const [continuousSessionId, setContinuousSessionId] = useState<string | null>(null);
  const [isContinuousDetecting, setIsContinuousDetecting] = useState(false);
  const [continuousEventSource, setContinuousEventSource] = useState<EventSource | null>(null);

  // 高级选项
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [buttonSelector, setButtonSelector] = useState('body > div:nth-child(3) > div.sm\\:container.mx-auto.px-4.content-without-search.pb-12 > div > div.flex-1.order-first > div:nth-child(1) > div.relative.-mx-4.sm\\:m-0.-mt-6 > div > div > button');
  const [clickWaitTime, setClickWaitTime] = useState(3000);
  const [timeout, setTimeoutValue] = useState(60000); // 默认60秒，给点击操作更多时间
  const [headless, setHeadless] = useState(true);

  const detectVideoUrls = async () => {
    const url = videoUrl.trim();

    if (!url) {
      setError('请输入视频页面 URL');
      return;
    }

    setLoading(true);
    setError(null);
    setVideoUrls([]);
    setSuccessMessage(null);

    try {
      const requestBody: any = { url };

      // 添加高级选项
      if (buttonSelector.trim()) {
        requestBody.buttonSelector = buttonSelector.trim();
      }
      if (clickWaitTime > 0) {
        requestBody.clickWaitTime = clickWaitTime;
      }
      if (timeout > 0) {
        requestBody.timeout = timeout;
      }
      requestBody.headless = headless;
      

      const response = await fetch(`${API_BASE}/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '检测失败');
      }

      if (data.success && data.data.videoUrls.length > 0) {
        setVideoUrls(data.data.videoUrls);
      } else {
        setError('未检测到视频地址，请确认 URL 是否正确');
      }
    } catch (err) {
      setError(`检测失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  // 检查是否是 m3u8 文件
  const isM3U8File = (videoInfo: VideoInfo): boolean => {
    const url = videoInfo.url.toLowerCase();
    const contentType = (videoInfo.contentType || '').toLowerCase();
    
    return url.includes('.m3u8') || 
           contentType.includes('application/vnd.apple.mpegurl') ||
           contentType.includes('application/x-mpegurl') ||
           contentType.includes('mpegurl');
  };

  // 检查是否是本地文件路径
  const isLocalFilePath = (path: string): boolean => {
    // Windows 路径: C:\ 或 \ 开头
    // Unix 路径: / 开头（但不是 http:// 或 https://）
    return (path.length > 0 && path[0] === '/') || 
           (path.length > 1 && path[1] === ':') ||
           (path.includes('\\') && !path.startsWith('http'));
  };

  const downloadVideo = async (videoInfo: VideoInfo, index: number) => {
    const videoUrl = videoInfo.url;
    try {
      let response: Response;
      let requestBody: any;
      let isM3U8 = false;

      // 检查是否是本地 m3u8 文件
      if (isLocalFilePath(videoUrl) && videoUrl.includes('.m3u8')) {
        // 使用 m3u8 文件下载端点
        isM3U8 = true;
        requestBody = {
          m3u8FilePath: videoUrl,
          options: {}
        };
        response = await fetch(`${API_BASE}/download/m3u8`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
      } else if (isM3U8File(videoInfo)) {
        // 如果是 m3u8 URL，使用普通下载端点（后端会自动识别并处理）
        isM3U8 = true;
        requestBody = {
          url: videoUrl,
          options: {}
        };
        response = await fetch(`${API_BASE}/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
      } else {
        // 普通视频下载
        requestBody = {
          url: videoUrl,
          options: {}
        };
        response = await fetch(`${API_BASE}/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '下载失败');
      }

      if (data.success && data.data.taskId) {
        const taskId = data.data.taskId;

        // 初始化进度（使用videoUrl作为key）
        setDownloadProgress(prev => {
          const newMap = new Map(prev);
          newMap.set(videoUrl, {
            taskId,
            videoUrl,
            progress: 0,
            message: isM3U8 ? '准备下载 m3u8 视频（将自动下载片段并合并）...' : '准备下载...',
            status: 'pending'
          });
          return newMap;
        });

        // 连接SSE获取进度
        const eventSource = new EventSource(`${API_BASE}/progress/${taskId}`);

        eventSource.onmessage = (event) => {
          try {
            const progressData = JSON.parse(event.data);

            if (progressData.type === 'progress') {
              setDownloadProgress(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(videoUrl);
                if (existing) {
                  newMap.set(videoUrl, {
                    ...existing,
                    progress: progressData.progress || 0,
                    message: progressData.message || '下载中...',
                    status: progressData.status || 'downloading'
                  });
                }
                return newMap;
              });
            } else if (progressData.type === 'completed') {
              setDownloadProgress(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(videoUrl);
                if (existing) {
                  newMap.set(videoUrl, {
                    ...existing,
                    progress: 100,
                    message: '下载完成',
                    status: 'completed'
                  });
                }
                return newMap;
              });

              setSuccessMessage(`视频 ${index + 1} 下载成功！保存路径: ${progressData.outputPath || 'downloads 目录'}`);
              window.setTimeout(() => {
                setSuccessMessage(null);
              }, 5000);

              // 3秒后移除进度显示
              window.setTimeout(() => {
                setDownloadProgress(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(videoUrl);
                  return newMap;
                });
              }, 3000);

              eventSource.close();
            } else if (progressData.type === 'failed') {
              setDownloadProgress(prev => {
                const newMap = new Map(prev);
                const existing = newMap.get(videoUrl);
                if (existing) {
                  newMap.set(videoUrl, {
                    ...existing,
                    progress: existing.progress,
                    message: progressData.message || '下载失败',
                    status: 'failed'
                  });
                }
                return newMap;
              });

              setError(`下载失败: ${progressData.message || '未知错误'}`);

              // 5秒后移除进度显示
              window.setTimeout(() => {
                setDownloadProgress(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(videoUrl);
                  return newMap;
                });
              }, 5000);

              eventSource.close();
            }
          } catch (err) {
            console.error('解析进度数据失败:', err);
          }
        };

        eventSource.onerror = (err) => {
          console.error('SSE连接错误:', err);
          eventSource.close();
          setError('获取下载进度失败');
        };
      }
    } catch (err) {
      setError(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      detectVideoUrls();
    }
  };

  // 启动持续检测
  const startContinuousDetection = async () => {
    const url = videoUrl.trim();
    
    if (!url) {
      setError('请输入视频页面 URL');
      return;
    }

    // 如果已经在检测，先停止
    if (isContinuousDetecting && continuousSessionId) {
      await stopContinuousDetection();
    }

    setLoading(true);
    setError(null);
    setVideoUrls([]);
    setSuccessMessage(null);

    try {
      const requestBody: any = { url };
      if (timeout > 0) {
        requestBody.timeout = timeout;
      }
      // 持续检测默认显示浏览器，方便用户操作
      requestBody.headless = false;

      const response = await fetch(`${API_BASE}/detect/continuous/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '启动持续检测失败');
      }

      if (data.success && data.data.sessionId) {
        const sessionId = data.data.sessionId;
        setContinuousSessionId(sessionId);
        setIsContinuousDetecting(true);
        
        // 设置初始视频列表
        if (data.data.initialVideos && data.data.initialVideos.length > 0) {
          setVideoUrls(data.data.initialVideos);
        }

        // 连接SSE获取新视频
        const eventSource = new EventSource(`${API_BASE}/detect/continuous/events/${sessionId}`);
        setContinuousEventSource(eventSource);

        eventSource.onmessage = (event) => {
          try {
            const eventData = JSON.parse(event.data);
            
            if (eventData.type === 'newVideo') {
              // 发现新视频，添加到列表
              setVideoUrls(prev => {
                // 检查是否已存在
                const exists = prev.some(v => v.url === eventData.video.url);
                if (!exists) {
                  const newList = [...prev, eventData.video];
                  setSuccessMessage(`发现新视频！当前共 ${newList.length} 个视频`);
                  window.setTimeout(() => {
                    setSuccessMessage(null);
                  }, 3000);
                  return newList;
                }
                return prev;
              });
            } else if (eventData.type === 'started') {
              // 检测已启动
              if (eventData.initialVideos && eventData.initialVideos.length > 0) {
                setVideoUrls(eventData.initialVideos);
              }
            } else if (eventData.type === 'stopped') {
              // 检测已停止
              setIsContinuousDetecting(false);
              setContinuousSessionId(null);
              eventSource.close();
              setContinuousEventSource(null);
            } else if (eventData.type === 'error') {
              setError(eventData.message || '持续检测出错');
              setIsContinuousDetecting(false);
              eventSource.close();
              setContinuousEventSource(null);
            }
          } catch (err) {
            console.error('解析事件数据失败:', err);
          }
        };

        eventSource.onerror = (err) => {
          console.error('SSE连接错误:', err);
          setError('获取新视频失败，连接已断开');
          setIsContinuousDetecting(false);
          eventSource.close();
          setContinuousEventSource(null);
        };

        setSuccessMessage('持续检测已启动，浏览器将保持打开，新发现的视频会实时更新');
        window.setTimeout(() => {
          setSuccessMessage(null);
        }, 5000);
      }
    } catch (err) {
      setError(`启动持续检测失败: ${err instanceof Error ? err.message : '未知错误'}`);
      setIsContinuousDetecting(false);
    } finally {
      setLoading(false);
    }
  };

  // 停止持续检测
  const stopContinuousDetection = async () => {
    if (!continuousSessionId) {
      return;
    }

    try {
      // 关闭SSE连接
      if (continuousEventSource) {
        continuousEventSource.close();
        setContinuousEventSource(null);
      }

      const response = await fetch(`${API_BASE}/detect/continuous/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: continuousSessionId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '停止持续检测失败');
      }

      setIsContinuousDetecting(false);
      setContinuousSessionId(null);
      setSuccessMessage('持续检测已停止');
      window.setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      setError(`停止持续检测失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  // 组件卸载时清理
  React.useEffect(() => {
    return () => {
      if (continuousEventSource) {
        continuousEventSource.close();
      }
      if (continuousSessionId) {
        stopContinuousDetection();
      }
    };
  }, []);

  return (
    <div className="container">
      <header>
        <h1>🎬 视频下载器</h1>
        <p>支持 HLS、DASH 等多种流媒体格式</p>
      </header>

      <main>
        <div className="input-section">
          <div className="input-group">
            <label htmlFor="videoUrl">视频页面 URL：</label>
            <input
              type="text"
              id="videoUrl"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="例如: https://missav.ws/dm18/dandy-714#00:00:02"
            />
          </div>

          {/* 高级选项 */}
          <div className="advanced-options">
            <button
              type="button"
              className="btn-toggle-advanced"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? '▼' : '▶'} 高级选项
            </button>

            {showAdvanced && (
              <div className="advanced-content">
                <div className="input-group">
                  <label htmlFor="buttonSelector">
                    按钮选择器（可选）：
                    <span className="help-text">点击此按钮会触发新视频下载</span>
                  </label>
                  <input
                    type="text"
                    id="buttonSelector"
                    value={buttonSelector}
                    onChange={(e) => setButtonSelector(e.target.value)}
                    placeholder="例如: body > div > button"
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="clickWaitTime">
                    点击后等待时间（毫秒）：
                  </label>
                  <input
                    type="number"
                    id="clickWaitTime"
                    value={clickWaitTime}
                    onChange={(e) => setClickWaitTime(parseInt(e.target.value) || 3000)}
                    min="0"
                    step="1000"
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="timeout">
                    超时时间（毫秒）：
                    <span className="help-text">页面加载和操作的超时时间，需要点击按钮等待视频出现时可设置更大值</span>
                  </label>
                  <input
                    type="number"
                    id="timeout"
                    value={timeout}
                    onChange={(e) => setTimeoutValue(parseInt(e.target.value) || 60000)}
                    min="10000"
                    step="10000"
                  />
                </div>

                <div className="input-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={headless}
                      onChange={(e) => setHeadless(e.target.checked)}
                    />
                    <span>无头模式（不显示浏览器窗口）</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={detectVideoUrls}
              disabled={loading || isContinuousDetecting}
              style={{ flex: 1 }}
            >
              {loading ? '检测中...' : '检测视频地址'}
            </button>
            
            {!isContinuousDetecting ? (
              <button
                className="btn btn-continuous"
                onClick={startContinuousDetection}
                disabled={loading}
                style={{ flex: 1 }}
              >
                启动持续检测
              </button>
            ) : (
              <button
                className="btn btn-stop"
                onClick={stopContinuousDetection}
                disabled={loading}
                style={{ flex: 1 }}
              >
                停止持续检测
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>正在检测视频地址...</p>
          </div>
        )}

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="success-message">
            {successMessage}
          </div>
        )}

        {isContinuousDetecting && (
          <div className="continuous-detection-status">
            <div className="status-indicator">
              <span className="status-dot"></span>
              <span>持续检测中... 浏览器保持打开，新发现的视频会实时更新</span>
            </div>
          </div>
        )}

        {videoUrls.length > 0 && (
          <div className="results">
            <h2>检测到的视频地址（共 {videoUrls.length} 个）：</h2>
            <div className="video-list">
              {videoUrls.map((videoInfo, index) => (
                <div key={index} className="video-item">
                  <div className="video-item-header">
                    <span className="video-item-index">视频 {index + 1}</span>
                    {videoInfo.formattedSize && (
                      <span className="video-size">{videoInfo.formattedSize}</span>
                    )}
                  </div>
                  <div className="video-url">{videoInfo.url}</div>
                  {videoInfo.contentType && (
                    <div className="video-type">类型: {videoInfo.contentType}</div>
                  )}
                  {isM3U8File(videoInfo) && (
                    <div className="video-type m3u8-badge">
                      📹 HLS 流媒体（将自动下载片段并合并）
                    </div>
                  )}
                  <button
                    className="btn btn-download"
                    onClick={() => downloadVideo(videoInfo, index)}
                    disabled={downloadProgress.has(videoInfo.url) &&
                      (downloadProgress.get(videoInfo.url)?.status === 'downloading' ||
                       downloadProgress.get(videoInfo.url)?.status === 'pending')}
                  >
                    {downloadProgress.has(videoInfo.url) &&
                     downloadProgress.get(videoInfo.url)?.status === 'downloading'
                      ? '下载中...'
                      : downloadProgress.has(videoInfo.url) &&
                        downloadProgress.get(videoInfo.url)?.status === 'completed'
                      ? '下载完成'
                      : '下载视频'}
                  </button>

                  {/* 下载进度显示 */}
                  {downloadProgress.has(videoInfo.url) && (() => {
                    const progress = downloadProgress.get(videoInfo.url)!;
                    if (progress.status === 'pending' || progress.status === 'downloading' ||
                        progress.status === 'completed' || progress.status === 'failed') {
                      return (
                        <div key={progress.taskId} className="download-progress-container">
                          <div className="download-progress-header">
                            <span className="download-progress-message">{progress.message}</span>
                            <span className="download-progress-percent">{Math.round(progress.progress)}%</span>
                          </div>
                          <div className="download-progress-bar">
                            <div
                              className={`download-progress-fill ${progress.status === 'failed' ? 'failed' : ''}`}
                              style={{ width: `${progress.progress}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
