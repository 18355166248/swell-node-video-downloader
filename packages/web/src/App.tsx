import { useState } from 'react';
import './App.css';

const API_BASE = '/api/video';

interface VideoInfo {
  url: string;
  contentType?: string | null;
  size?: number | null;
  formattedSize?: string | null;
}

function App() {
  const [videoUrl, setVideoUrl] = useState('https://missav.ws/dm18/dandy-714#00:00:02');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<VideoInfo[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 高级选项
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [buttonSelector, setButtonSelector] = useState('body > div:nth-child(3) > div.sm\\:container.mx-auto.px-4.content-without-search.pb-12 > div > div.flex-1.order-first > div:nth-child(1) > div.relative.-mx-4.sm\\:m-0.-mt-6 > div > div > button');
  const [clickWaitTime, setClickWaitTime] = useState(3000);
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

  const downloadVideo = async (videoInfo: VideoInfo, index: number) => {
    const videoUrl = videoInfo.url;
    try {
      const response = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: videoUrl,
          options: {}
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '下载失败');
      }

      if (data.success) {
        setSuccessMessage(`视频 ${index + 1} 下载成功！保存路径: ${data.data.outputPath || 'downloads 目录'}`);
        setTimeout(() => {
          setSuccessMessage(null);
        }, 5000);
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

          <button
            className="btn btn-primary"
            onClick={detectVideoUrls}
            disabled={loading}
          >
            {loading ? '检测中...' : '检测视频地址'}
          </button>
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
                  <button
                    className="btn btn-download"
                    onClick={() => downloadVideo(videoInfo, index)}
                  >
                    下载视频
                  </button>
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
