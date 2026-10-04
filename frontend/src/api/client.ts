// API 客户端 - 封装所有后端接口调用
const BASE_URL = "/api";

export interface GenerateRequest {
  topic?: string;
  url?: string;
  style: "tech" | "minimal" | "cute";
  scenes: number;
}

export interface JobStatus {
  status: "generating" | "rendering" | "done" | "error";
  progress: number;
  videoUrl?: string;
  script?: {
    title: string;
    scenes: Array<{
      title: string;
      body: string;
      keywords: string[];
      imageUrl: string;
    }>;
  };
  error?: string;
}

// 创建生成任务
export async function createGenerateJob(data: GenerateRequest): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error || "创建任务失败");
  }

  return res.json() as Promise<{ jobId: string }>;
}

// 查询任务状态
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${BASE_URL}/job/${jobId}`);

  if (!res.ok) {
    throw new Error("查询任务状态失败");
  }

  return res.json() as Promise<JobStatus>;
}

// 获取下载链接
export function getDownloadUrl(jobId: string): string {
  return `${BASE_URL}/download/${jobId}`;
}

// ============================================================
// 教学视频工作台
// ============================================================

export type VisualType =
  | "manim" | "equation" | "board" | "diagram"
  | "list" | "highlight" | "image" | "video";

export interface VisualEvent {
  id?: string;
  type: VisualType;
  at?: string;
  intent?: string;
  latex?: string;
  text?: string;
  items?: string[];
  imageUrl?: string;
  layout?: { x?: number; y?: number; w?: number; h?: number; scale?: number };
  sceneCode?: string;
  className?: string;
  generateError?: string;
}

export interface Beat {
  narration: string;
  visuals?: VisualEvent[];
  quiz?: { question: string; options: string[]; pauseSec?: number };
  layout?: string;
}

export interface LessonDoc {
  title: string;
  fps: number;
  width: number;
  height: number;
  style: string;
  learningObjectives?: string[];
  sections: { title: string; beats: Beat[] }[];
}

export interface LessonIssue {
  level: "error" | "warn";
  where: string;
  message: string;
}

export interface LessonStats {
  sections: number;
  beats: number;
  visuals: number;
  manimClips: number;
  chars: number;
}

export type LessonJobStep =
  | "queued" | "design" | "manim-code" | "timeline"
  | "manim-render" | "props" | "remotion" | "finished";

export interface LessonJob {
  id: string;
  kind: "design" | "manim-code" | "build";
  status: "running" | "done" | "error";
  step: LessonJobStep;
  progress: number;
  logs: string[];
  error?: string;
  lessonPath?: string;
  videoUrl?: string;
  stats?: { sections: number; beats: number; manimClips: number };
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, init);
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* 保留默认信息 */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface LessonFileInfo {
  name: string;
  title: string;
  stats: LessonStats | null;
  issues: number;
}

export const listLessons = () =>
  req<{ files: LessonFileInfo[] }>("/lesson/files").then((r) => r.files);

export const loadLesson = (name: string) =>
  req<{ lesson: LessonDoc; issues: LessonIssue[]; stats: LessonStats }>(
    `/lesson/file?name=${encodeURIComponent(name)}`,
  );

export const saveLesson = (name: string, lesson: LessonDoc) =>
  req<{ saved: boolean; issues: LessonIssue[]; stats: LessonStats; errors: number }>(
    "/lesson/file",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lesson }),
    },
  );

export const listOutputs = () =>
  req<{ videos: { name: string; sizeMB: number; mtime: number }[] }>(
    "/lesson/outputs",
  ).then((r) => r.videos);

export const startDesign = (data: {
  topic?: string;
  grade: string;
  beats: number;
  provider?: string;
  material?: string;
}) =>
  req<{ jobId: string }>("/lesson/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const startBuild = (data: {
  name: string;
  lesson: LessonDoc;
  provider?: string;
  quality?: string;
}) =>
  req<{ jobId: string }>("/lesson/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const getLessonJob = (jobId: string) =>
  req<{ job: LessonJob }>(`/lesson/job/${jobId}`).then((r) => r.job);

// ============================================================
// 模型提供商管理
// ============================================================

export interface ProviderView {
  id: string;
  name: string;
  vendor: string;
  kind: "openai-compat" | "gemini" | "anthropic" | "ollama" | "custom";
  baseURL?: string;
  apiKeyEnv?: string;
  /** 后端已抹掉密钥，这里只表示「有没有配」 */
  hasInlineKey: boolean;
  keyFromEnv: string | null;
  models: { id: string; label?: string; enabled: boolean }[];
  enabled: boolean;
  builtIn?: boolean;
  note?: string;
  status: { ready: boolean; note: string };
}

export const listProviders = () =>
  req<{ providers: ProviderView[]; selected?: string; configPath: string }>("/providers");

export const createProvider = (data: {
  name: string; vendor: string; kind: ProviderView["kind"];
  baseURL?: string; apiKey?: string; apiKeyEnv?: string; enabled?: boolean;
}) => req<{ provider: ProviderView }>("/providers", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
}).then((r) => r.provider);

/** 密钥可以写入，但读回来时后端会抹掉，所以类型上分开 */
export interface ProviderPatch {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
  models?: { id: string; label?: string; enabled: boolean }[];
  note?: string;
}

export const updateProvider = (id: string, patch: ProviderPatch) =>
  req<{ provider: ProviderView }>(`/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => r.provider);

export const deleteProvider = (id: string) =>
  req<{ deleted: boolean }>(`/providers/${id}`, { method: "DELETE" });

export const toggleProvider = (id: string, enabled: boolean) =>
  req<{ provider: ProviderView }>(`/providers/${id}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then((r) => r.provider);

export const toggleModel = (id: string, modelId: string, enabled: boolean) =>
  req<{ provider: ProviderView }>(
    `/providers/${id}/models/${encodeURIComponent(modelId)}/toggle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  ).then((r) => r.provider);

export const addModel = (id: string, modelId: string) =>
  req<{ provider: ProviderView }>(`/providers/${id}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: modelId }),
  }).then((r) => r.provider);

export const deleteModel = (id: string, modelId: string) =>
  req<{ provider: ProviderView }>(
    `/providers/${id}/models/${encodeURIComponent(modelId)}`,
    { method: "DELETE" },
  ).then((r) => r.provider);

export const discoverModels = (id: string) =>
  req<{ discovered: number; provider: ProviderView }>(`/providers/${id}/discover`, {
    method: "POST",
  });

export const testProvider = (id: string, model: string) =>
  req<{
    ok: boolean;
    latencyMs: number;
    sample: string;
    error?: string;
    /** 空内容但模型本身可能是好的（如推理模型吃光 token 预算） */
    inconclusive?: boolean;
    model: string;
  }>(
    `/providers/${id}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    },
  );

export const selectProvider = (spec: string) =>
  req<{ selected?: string }>("/providers/selected", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec }),
  });
