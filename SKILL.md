---
name: hotspot-auto-writer
description: "每日热点自动写作：Agent Reach全渠道搜索 → AI分析 → 笔杆子agent生成 → 自动发布"
version: "2.2.0"
metadata:
  openclaw:
    emoji: "🔥"
    requires:
      skills: ["agent-reach", "wechat-prompt-context", "wechat-mp-publisher"]
    cron: "0 9 * * *"
---

# 🔥 热点自动写作技能 (全自动版)

每天定时搜索全网热点 → AI 主编级评估 → 笔杆子 agent 创作 → 自动发布到公众号草稿箱。

## 工作流

```
9:00 定时触发
    ↓
步骤1: Agent Reach 全渠道搜索 (5 平台)
    ├── 微博热搜 (Cookie 登录)
    ├── 知乎热榜 (Cookie 登录)
    ├── B站热门
    ├── 小红书热门
    └── Twitter 趋势
    ↓ (~20 秒，聚合 ~38 条)
步骤2: AI 主编级评估 (5 维打分)
    ├── 深度 + 原创 + 价值 + 时效 + 安全
    ├── 并发 5 个/批，3 批完成
    └─ 输出: Top 2 话题
    ↓ (~4.5 分钟)
步骤3: 并行生成文章 (工作进程模式)
    ├── Worker 1: 临时目录 A → 笔杆子 agent
    ├── Worker 2: 临时目录 B → 笔杆子 agent
    ├── 每篇: 封面 + 文章 + 内容校验
    └─ 输出: article-1.md + cover-1.jpg
    ↓ (~3.3 分钟)
步骤4: 串行发布 (避免 API 限流)
    ├── 校验 Frontmatter + 字数 + 编码
    ├── 封面自动压缩
    └── wenyan-cli publish → 微信草稿箱
    ↓ (~8 秒)
完成: 2 篇文章发布到草稿箱 (总耗时 ~8 分钟)
```

## 已配置渠道

| 渠道 | 平台 | 搜索内容 | 状态 | Cookie |
|------|------|----------|------|--------|
| 1 | 微博 | 热搜榜 | ✅ | ✅ 已配置 |
| 2 | 知乎 | 热榜 | ✅ | ✅ 已配置 |
| 3 | 小红书 | 热门笔记 | ✅ | - |
| 4 | B站 | 热门视频 | ✅ | - |
| 5 | Twitter/X | 趋势话题 | ✅ | - |

## 使用方法

### 手动执行

```bash
# 全自动（跳过确认）
node ~/.openclaw/workspace/skills/hotspot-auto-writer/scripts/auto-write.js --auto

# 手动模式（逐步确认）
node ~/.openclaw/workspace/skills/hotspot-auto-writer/scripts/auto-write.js
```

### 定时执行

```bash
# 安装定时任务（每天 9 点）
bash ~/.openclaw/workspace/skills/hotspot-auto-writer/cron/install.sh

# 查看日志
tail -f ~/.openclaw/logs/hotspot-auto-writer.log
```

## 架构设计

### 核心文件

| 文件 | 功能 |
|------|------|
| `scripts/auto-write.js` | 主流程编排器 |
| `scripts/generate-article-worker.js` | 文章生成工作进程（资源隔离） |
| `scripts/test-agent-write.js` | 端到端测试脚本 |
| `config/prompts.js` | 5 维评估框架配置 |

### 关键设计

| 决策 | 方案 | 原因 |
|------|------|------|
| 文章生成 | `openclaw agent --agent creator` | 利用 agent 框架级模型管理 |
| 并行架构 | 独立工作进程 + 临时目录 | 避免 OOM SIGKILL |
| 发布策略 | 串行发布 | 避免微信 API 限流 |
| 封面策略 | Pexels 优先 → 豆包备选 | 真实图片质量更高 |
| 内容校验 | 双阶段拦截 | 不完整文章不发布 |
| 幂等保护 | MD5 指纹 + 30 分钟窗口 | 防止重复发布 |
| 思考过滤 | `filterAgentOutput()` | 过滤 agent 英文 planning |

## 输出结构

```
output/YYYY-MM-DD/
├── hotspots.json          # 所有热点原始数据
├── article-1.md           # 文章 1（含 Frontmatter）
├── article-2.md           # 文章 2（含 Frontmatter）
├── cover-1.jpg            # 封面 1
├── cover-2.jpg            # 封面 2
├── articles.json          # 生成元数据
└── hotspots.json          # 热点数据
```

## 性能指标

| 环节 | 耗时 |
|:---|:---|
| 热点搜索 (5 渠道) | ~20 秒 |
| AI 评估 | ~4.5 分钟 |
| 并行文章生成 | ~3.3 分钟 |
| 串行发布 | ~8 秒 |
| **总计** | **~8 分钟** |

## 依赖

- Agent Reach (12+ 渠道)
- wechat-prompt-context (文章生成)
- wechat-mp-publisher (公众号发布)
- wenyan-cli (发布工具)
- OpenClaw `creator` 笔杆子 agent

## 版本

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
