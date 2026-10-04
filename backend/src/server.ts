import "dotenv/config";
import express from "express";
import cors from "cors";
import * as path from "path";
import generateRouter from "./routes/generate";
import lessonRouter from "./routes/lesson";
import providersRouter from "./routes/providers";

const app = express();
const PORT = process.env.PORT || 3001;

// 项目根。用 __dirname 推导而不是 process.cwd() —— 后端可能从
// 任意目录启动（npm workspaces 会把 cwd 设成 backend/），
// 靠 cwd 拼路径会错。
const ROOT = path.resolve(__dirname, "../..");

// 中间件
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

// 静态文件（渲染完成的视频）
app.use("/output", express.static(path.join(process.cwd(), "output")));
// 教学视频成片
app.use("/lesson-videos", express.static(path.join(ROOT, "video", "out")));

// API 路由
app.use("/api", generateRouter);
app.use("/api/lesson", lessonRouter);
app.use("/api/providers", providersRouter);

// 健康检查
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve 前端静态文件
const frontendPath = path.join(ROOT, "frontend", "dist");
app.use(express.static(frontendPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 AI视频生成器后端已启动: http://localhost:${PORT}`);
  console.log(`📁 项目根: ${ROOT}`);
  console.log(`🤖 LLM: ${process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini(默认)" : "未配置")}`);
  console.log(`🎬 Manim: ${require("fs").existsSync(path.join(ROOT, "pipeline", "manim-venv", "bin", "manim")) ? "已就绪" : "未安装"}`);
});

export default app;
