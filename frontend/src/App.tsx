import React, { useState, useCallback, useRef } from "react";
import { StyleSelector } from "./components/StyleSelector";
import { ProgressCard } from "./components/ProgressCard";
import {
  createGenerateJob,
  getJobStatus,
  getDownloadUrl,
  type JobStatus,
} from "./api/client";
import LessonStudio from "./pages/LessonStudio";
import ProviderAdmin from "./pages/ProviderAdmin";

type VideoStyle = "tech" | "minimal" | "cute";
type AppState = "idle" | "loading";
type InputMode = "topic" | "url";

// 抖音短视频工具（原主组件，逻辑未动）
function ShortVideoTool() {
  const [inputMode, setInputMode] = useState<InputMode>("topic");
  const [topic, setTopic] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [style, setStyle] = useState<VideoStyle>("tech");
  const [sceneCount, setSceneCount] = useState(5);
  const [appState, setAppState] = useState<AppState>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 开始轮询任务状态
  const startPolling = useCallback((id: string) => {
    const poll = async () => {
      try {
        const status = await getJobStatus(id);
        setJobStatus(status);

        if (status.status === "done" || status.status === "error") {
          stopPolling();
          setAppState("idle");
        }
      } catch {
        console.error("轮询状态失败");
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 2000);
  }, [stopPolling]);

  // 点击生成按钮
  const handleGenerate = async () => {
    const currentValue = inputMode === "topic" ? topic.trim() : urlInput.trim();
    if (!currentValue) {
      alert(inputMode === "topic" ? "请输入视频主题" : "请输入 URL");
      return;
    }

    stopPolling();
    setJobStatus(null);
    setJobId(null);
    setAppState("loading");

    try {
      const payload = inputMode === "topic"
        ? { topic: currentValue, style, scenes: sceneCount }
        : { url: currentValue, style, scenes: sceneCount };

      const { jobId: newJobId } = await createGenerateJob(payload);
      setJobId(newJobId);
      startPolling(newJobId);
    } catch (err) {
      setAppState("idle");
      alert((err as Error).message || "创建任务失败，请检查后端服务是否运行");
    }
  };

  // 下载视频
  const handleDownload = () => {
    if (jobId) {
      const downloadUrl = getDownloadUrl(jobId);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${inputMode === "topic" ? topic : urlInput}-${style}.mp4`;
      a.click();
    }
  };

  const isGenerating = appState === "loading" && jobStatus &&
    (jobStatus.status === "generating" || jobStatus.status === "rendering");

  const canSubmit = inputMode === "topic" ? topic.trim().length > 0 : urlInput.trim().length > 0;

  return (
    <div className="min-h-screen tech-bg relative">
      {/* 装饰性网格背景 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(0,212,255,0.3) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(0,212,255,0.3) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-12">
        {/* 页头 */}
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-cyan-400 text-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            AI 驱动 · 自动生成
          </div>
          <h1 className="text-5xl font-black text-white mb-4 tracking-tight">
            AI 视频生成器
          </h1>
          <p className="text-white/50 text-lg">
            输入主题或粘贴链接，一键生成抖音/小红书竖屏短视频
          </p>
        </header>

        {/* 主表单卡片 */}
        <div className="glass-card rounded-2xl p-6 space-y-6">

          {/* 输入模式切换 */}
          <div className="flex rounded-xl bg-white/5 p-1 gap-1">
            {(["topic", "url"] as InputMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                disabled={!!isGenerating}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                  ${inputMode === mode
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                    : "text-white/40 hover:text-white/60"
                  }
                `}
              >
                {mode === "topic" ? "📝 输入主题" : "🔗 粘贴链接"}
              </button>
            ))}
          </div>

          {/* 动态输入区 */}
          {inputMode === "topic" ? (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">
                视频主题
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="例如：5个提升效率的AI工具、减肥的3个秘诀..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white
                           placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50
                           focus:bg-white/8 transition-all duration-200 text-sm"
                disabled={!!isGenerating}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">
                文章 / 博客 / 新闻链接
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="https://..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white
                           placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50
                           focus:bg-white/8 transition-all duration-200 text-sm"
                disabled={!!isGenerating}
              />
              <p className="text-xs text-white/30">
                AI 自动抓取正文 → 提炼核心观点 → 生成视频脚本
              </p>
            </div>
          )}

          {/* 视频风格选择 */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white/70">
              视频风格
            </label>
            <StyleSelector value={style} onChange={setStyle} />
          </div>

          {/* 场景数量 */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white/70">
              场景数量
              <span className="ml-2 text-cyan-400 font-bold">{sceneCount}</span>
            </label>
            <input
              type="range"
              min={3}
              max={8}
              value={sceneCount}
              onChange={(e) => setSceneCount(Number(e.target.value))}
              className="w-full accent-cyan-500"
              disabled={!!isGenerating}
            />
            <div className="flex justify-between text-xs text-white/30">
              <span>3个场景（约18秒）</span>
              <span>8个场景（约50秒）</span>
            </div>
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={!!isGenerating || !canSubmit}
            className={`
              w-full py-4 rounded-xl font-bold text-lg transition-all duration-200
              flex items-center justify-center gap-3
              ${isGenerating || !canSubmit
                ? "bg-white/10 text-white/30 cursor-not-allowed"
                : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 active:scale-[0.98] shadow-lg shadow-cyan-500/20"
              }
            `}
          >
            {isGenerating ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {inputMode === "url" && jobStatus?.status === "generating" ? "抓取并分析中..." : "生成中..."}
              </>
            ) : (
              <>
                <span>🎬</span>
                开始生成视频
              </>
            )}
          </button>
        </div>

        {/* 进度/结果展示 */}
        {jobStatus && (
          <div className="mt-6">
            <ProgressCard jobStatus={jobStatus} onDownload={handleDownload} />
          </div>
        )}

        {/* 使用说明 */}
        {!jobStatus && (
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {(inputMode === "topic"
              ? [
                  { icon: "📝", label: "AI 生成脚本", desc: "Gemini 自动创作" },
                  { icon: "🖼", label: "智能配图", desc: "Unsplash 精选图片" },
                  { icon: "🎬", label: "自动渲染", desc: "1080×1920 竖屏" },
                ]
              : [
                  { icon: "🔗", label: "抓取正文", desc: "自动提取文章内容" },
                  { icon: "✂️", label: "提炼观点", desc: "Gemini 精选核心" },
                  { icon: "🎬", label: "生成视频", desc: "一键转成短视频" },
                ]
            ).map((item) => (
              <div key={item.label} className="p-4 glass-card rounded-xl">
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-sm font-bold text-white">{item.label}</div>
                <div className="text-xs text-white/40 mt-1">{item.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* 底部说明 */}
        <footer className="mt-8 text-center text-white/20 text-xs">
          渲染完成后视频将自动可下载 · 支持抖音/小红书格式
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// 根组件：工具切换
// ============================================================

type Tool = "short" | "lesson" | "providers";

const TABS: { key: Tool; label: string; hint: string }[] = [
  { key: "short", label: "抖音短视频", hint: "一句话 → 竖屏短视频" },
  { key: "lesson", label: "教学视频", hint: "课程设计 → 分层讲解课" },
  { key: "providers", label: "模型管理", hint: "增删改模型提供商 · 启停 · 自动拉取模型" },
];

function Root() {
  const [tool, setTool] = React.useState<Tool>("short");
  const [, setTick] = React.useState(0);
  // 必须 useCallback：内联箭头会让 ProviderAdmin 的 effect 依赖链每渲染都变
  const onProvidersChanged = React.useCallback(() => setTick((t) => t + 1), []);

  return (
    <div className="min-h-screen tech-bg relative">
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(0,212,255,0.3) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(0,212,255,0.3) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* 工具切换 */}
      <nav className="relative z-20 border-b border-cyan-500/20 bg-black/40 backdrop-blur sticky top-0">
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              className={`px-4 py-3 text-sm transition-colors border-b-2 -mb-px ${
                tool === t.key
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tool === "short" ? <ShortVideoTool />
        : tool === "lesson" ? <LessonStudio />
        : <ProviderAdmin onChanged={onProvidersChanged} />}
    </div>
  );
}

export default Root;
