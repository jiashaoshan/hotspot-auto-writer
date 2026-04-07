# 🔥 Hotspot Auto-Writer

全自动热点写作技能 — 从热点搜索 → AI 评估 → 文章生成 → 公众号发布的完整自动化工作流

[![GitHub](https://img.shields.io/badge/GitHub-jiashaoshan-blue)](https://github.com/jiashaoshan/hotspot-auto-writer)

---

## ✨ 功能特性

- **🔍 5 大平台热点聚合**：微博 / 知乎 / B站 / 小红书 / Twitter（支持 Cookie 登录）
- **🤖 AI 主编级评估**：5 维评估框架（深度 / 原创 / 价值 / 时效 / 安全），并发 5 路评估
- **✍️ 笔杆子 agent 生成**：调用 OpenClaw `creator` agent，支持 Supermemory 记忆注入
- **🚀 并行生成 + 串行发布**：2 篇文章同时生成，避免 OOM；发布串行避免 API 限流
- **🖼️ 智能封面**：Pexels 真实图片优先，豆包 AI 生成备选，自动压缩至微信限制内
- **🛡️ 内容校验拦截**：字数 <1500 或乱码 >5 处自动拦截，不完整文章不发布
- **🔒 幂等性保护**：基于内容 MD5 指纹，30 分钟内不重复发布相同文章
- **⚡ 全流程 ~8 分钟**：从搜索到草稿箱，无需人工干预

---

## 📋 完整工作流

```
┌─────────────────────────────────────────────────────────┐
│  步骤1: Agent Reach 搜索热点 (5 渠道)                     │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┐  │
│  │ 微博      │ 知乎      │ B站      │ 小红书    │ Twitter│  │
│  │ ~8 条     │ ~8 条     │ ~10 条   │ ~4 条     │ ~8 条  │  │
│  └──────────┴──────────┴──────────┴──────────┴────────┘  │
│                      ↓ 聚合 ~38 条                          │
├─────────────────────────────────────────────────────────┤
│  步骤2: AI 主编级评估 (LLM 调用)                           │
│  ├─ 筛选标准: 深度 + 原创 + 价值 + 时效 + 安全               │
│  ├─ 并发评估: 5 个/批，3 批完成                               │
│  └─ 输出: Top 2 话题 (标题 + 角度 + 文章类型)                  │
├─────────────────────────────────────────────────────────┤
│  步骤3: 并行生成文章 (工作进程模式)                          │
│  ├─ 工作进程 1: 独立临时目录 → 笔杆子 agent 生成               │
│  ├─ 工作进程 2: 独立临时目录 → 笔杆子 agent 生成               │
│  ├─ 每篇: 封面生成 → 文章生成 → 内容校验                      │
│  └─ 输出: article-1.md + cover-1.jpg 等                      │
├─────────────────────────────────────────────────────────┤
│  步骤4: 串行发布到公众号草稿箱                               │
│  ├─ 校验: Frontmatter + 字数 + 编码完整性                    │
│  ├─ 封面: 自动压缩至微信限制                                 │
│  ├─ 发布: wenyan-cli publish → 微信 API                      │
│  └─ 输出: Media ID + 发布确认                               │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ 技术架构

### 核心文件

| 文件 | 功能 | 关键逻辑 |
|------|------|----------|
| `scripts/auto-write.js` | 主流程编排器 | 搜索 → 评估 → 生成 → 发布 |
| `scripts/generate-article-worker.js` | 文章生成工作进程 | 临时目录隔离 + 笔杆子 agent |
| `scripts/test-agent-write.js` | 端到端测试脚本 | 单篇生成 → 发布验证 |
| `config/prompts.js` | 评估框架配置 | 5 维评估标准 + 提示词模板 |

### 文章生成架构

```
auto-write.js (主进程)
    │
    ├── spawn worker-1 (临时目录 A) ──┐
    │   ├── 复制 wechat-prompt-context 脚本
    │   ├── 复制 wechat-ai-writer 依赖
    │   ├── execSync: write-article.js
    │   │   └── openclaw agent --agent creator
    │   ├── 内容校验 (字数 + 编码)
    │   └── 输出 article.md + cover.jpg
    │
    └── spawn worker-2 (临时目录 B) ──┘
            (同上，资源隔离)

主进程等待所有 worker 完成
    ↓
串行发布: publishSingleArticle() × N
    ↓
写入 .publish-history.json (幂等保护)
```

### 关键设计决策

| 决策 | 方案 | 原因 |
|------|------|------|
| 文章生成方式 | `openclaw agent --agent creator` | 利用 agent 框架级模型管理和 Supermemory |
| 并行架构 | 独立工作进程 + 临时目录隔离 | 避免 `Promise.all` 内存峰值导致 OOM |
| 发布策略 | 串行发布 | 避免微信 API 限流 |
| 封面策略 | Pexels 优先 → 豆包 AI 备选 | 真实图片质量更高，AI 作为兜底 |
| 内容校验 | 双阶段拦截 (生成 + 发布前) | 确保不完整文章不会被发布 |
| 思考过程过滤 | `filterAgentOutput()` | 过滤 agent 的英文 planning，只保留纯净文章 |

---

## 📦 依赖

### 必需技能

| 技能 | 用途 | 安装路径 |
|:---|:---|:---|
| `wechat-prompt-context` | 文章生成 + 封面 | `~/.openclaw/workspace/skills/wechat-prompt-context` |
| `wechat-mp-publisher` | 公众号发布 | `~/.openclaw/workspace/skills/wechat-mp-publisher` |
| `agent-reach` | 热点搜索 | `~/.agents/skills/agent-reach` |

### 必需 CLI 工具

| 工具 | 版本 | 用途 |
|:---|:---|:---|
| `wenyan-cli` | ≥2.0.2 | 公众号发布 |
| `@wenyan-md/core` | 2.0.2 | wenyan 依赖 |

### OpenClaw Agent 配置

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "creator",
        "name": "笔杆子",
        "workspace": "~/.openclaw/workspace-creator"
      }
    ]
  }
}
```

### 环境变量

```bash
export WECHAT_APP_ID="your_wechat_app_id"
export WECHAT_APP_SECRET="your_wechat_app_secret"
```

---

## 🚀 安装

### 1. 克隆仓库

```bash
cd ~/.openclaw/workspace/skills
git clone https://github.com/jiashaoshan/hotspot-auto-writer.git
cd hotspot-auto-writer
```

### 2. 安装依赖技能

```bash
# wechat-prompt-context
git clone https://github.com/jiashaoshan/wechat-prompt-context.git \
  ~/.openclaw/workspace/skills/wechat-prompt-context

# wechat-mp-publisher
git clone https://github.com/jiashaoshan/wechat-mp-publisher.git \
  ~/.openclaw/workspace/skills/wechat-mp-publisher
```

### 3. 安装 wenyan-cli

```bash
npm install -g @wenyan-md/cli@2.0.2

# 降级 core 库到兼容版本
cd ~/.npm-global/lib/node_modules/@wenyan-md/cli
npm install @wenyan-md/core@2.0.2
```

### 4. 安装 Agent Reach

```bash
# 参考: https://github.com/panniantong/agent-reach
```

### 5. 配置环境变量

```bash
# 添加到 ~/.zshrc
export WECHAT_APP_ID="wx43d98b327b62dcfa"
export WECHAT_APP_SECRET="your_secret"
source ~/.zshrc
```

---

## 💻 使用

### 自动模式（推荐）

```bash
node scripts/auto-write.js --auto
```

跳过所有人工确认，全自动执行：搜索 → 评估 → 生成 → 发布。

### 手动模式

```bash
node scripts/auto-write.js
```

每个步骤需要人工确认。

### 定时任务

```bash
crontab -e

# 每天上午 9 点自动运行
0 9 * * * cd ~/.openclaw/workspace/skills/hotspot-auto-writer && node scripts/auto-write.js --auto >> cron.log 2>&1
```

---

## 📁 输出结构

```
output/
└── 2026-04-07/
    ├── article-1.md       # 文章 1 正文（含 Frontmatter）
    ├── article-2.md       # 文章 2 正文（含 Frontmatter）
    ├── cover-1.jpg        # 文章 1 封面
    ├── cover-2.jpg        # 文章 2 封面
    ├── articles.json      # 生成元数据
    └── hotspots.json      # 热点原始数据
```

### 发布历史

```
~/.openclaw/workspace/.publish-history.json
```

记录已发布文章的 MD5 指纹，防止 30 分钟内重复发布。

---

## 🔧 配置

### 评估框架

编辑 `config/prompts.js`：

```javascript
const evaluationCriteria = {
  depth: "能否支撑 2500-3000 字深度文章",
  opinion: "是否有独特观点或分析角度",
  value: "对目标读者是否有认知 / 情绪 / 实用价值",
  timeliness: "热点时效是否适中（48-72 小时）",
  safety: "是否有政治 / 法律 / 舆论风险"
};
```

### 发布幂等性

```javascript
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 分钟
```

---

## 📊 性能指标

| 环节 | 耗时 | 说明 |
|:---|:---|:---|
| 热点搜索 (5 渠道) | ~20 秒 | 聚合 ~38 条 |
| AI 评估 | ~4.5 分钟 | 3 批 × 5 并发 |
| 并行文章生成 | ~3.3 分钟 | 2 worker 同时运行 |
| 串行发布 | ~8 秒 | 2 篇 |
| **总计** | **~8 分钟** | 全流程无 SIGKILL |

---

## 🔧 故障排除

| 问题 | 原因 | 解决 |
|------|------|------|
| 热点搜索返回 0 条 | Cookie 过期 | 重新登录对应平台 |
| AI 评估超时 | LLM 响应慢 | 检查网络，稍后重试 |
| 文章生成失败 | 笔杆子 agent 异常 | 检查 `openclaw agent --agent creator` 是否正常 |
| 发布成功但草稿箱没有 | IP 不在白名单 | 添加服务器 IP 到公众号白名单 |
| 封面图不显示 | 路径问题 | 检查 cover 字段是否为相对路径 |

---

## 📝 更新日志

### v2.2.0 (2026-04-07)

- ✅ 改用 `笔杆子 agent` 生成文章（`openclaw agent --agent creator`）
- ✅ 新增 `filterAgentOutput()` 过滤 agent 思考过程
- ✅ 全流程测试通过：2/2 生成并发布，无 SIGKILL
- ✅ 新增端到端测试脚本 `test-agent-write.js`
- ✅ 移除直接 API 调用逻辑，统一走 agent 框架

### v2.1.0 (2026-04-05)

- ✅ 添加微博/知乎 Cookie 登录支持
- ✅ AI 评估并发优化（5 并发评估）
- ✅ 文章生成并行化（独立临时目录）
- ✅ 封面 Pexels 优先策略
- ✅ YAML 转义修复

### v2.0.0 (2026-04-04)

- ✅ 修复 wenyan-cli 版本兼容
- ✅ 添加自动确认模式（--auto）
- ✅ 优化 5 维话题评估框架

### v1.0.0 (2026-04-01)

- 🎉 初始版本发布

---

## 📄 License

MIT License © 2026 Yang Yanqing
