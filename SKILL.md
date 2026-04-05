---
name: hotspot-auto-writer
description: "每日热点自动写作：Agent Reach全渠道搜索 → AI分析 → wechat-prompt-context生成 → 自动发布"
version: "2.0.0"
metadata:
  openclaw:
    emoji: "🔥"
    requires:
      skills: ["agent-reach", "wechat-prompt-context", "wechat-toolkit"]
    cron: "0 9 * * *"
---

# 🔥 热点自动写作技能 (全自动版)

**全自动工作流程**：每天定时搜索全网热点 → AI分析选出话题 → 调用wechat-prompt-context生成文章 → 发布到公众号草稿箱。

## 工作流程 (全自动)

```
9:00 定时触发
    ↓
步骤1: Agent Reach 全渠道搜索 (5大平台)
    ├── 微博热搜 (weibo) - Cookie登录
    ├── 知乎热榜 (zhihu) - Cookie登录
    ├── 小红书热门 (xiaohongshu)
    ├── B站热门 (bilibili)
    └── Twitter 趋势 (twitter)
    ↓
步骤2: AI 智能分析 (并发5个评估)
    ├── 聚合所有渠道热点 (约40-50条)
    ├── 评估5维度 (深度/原创性/价值/时效/安全)
    └── 选出 Top 2 最适合公众号的话题
    ↓
步骤3: 并发生成文章 (2篇同时)
    ├── 调用 wechat-prompt-context
    ├── 独立临时目录 (避免冲突)
    ├── LLM撰写文章 (2500-3000字)
    └── Pexels封面图 (优先) / 豆包生成 (备选)
    ↓
步骤4: 串行发布 (避免API限流)
    ├── 发布文章1到公众号草稿箱
    ├── 等待5秒
    └── 发布文章2到公众号草稿箱
    ↓
步骤5: 清理与通知
    ├── 清理临时目录
    └── 发送完成通知
```

## 已配置渠道 (5大平台)

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
# 一键全自动执行
node ~/.openclaw/workspace/skills/hotspot-auto-writer/scripts/auto-write.js

# 或调用主入口
node ~/.openclaw/workspace/skills/hotspot-auto-writer/scripts/main.js
```

### 定时执行
```bash
# 安装定时任务（每天9点自动执行）
bash ~/.openclaw/workspace/skills/hotspot-auto-writer/cron/install.sh

# 查看日志
tail -f ~/.openclaw/logs/hotspot-auto-writer.log
```

## 输出结构

```
output/YYYY-MM-DD/
├── hotspots.json          # 搜索到的所有热点
├── topics.json            # AI选出的Top 2话题
├── article-1.md           # 文章1
├── cover-1.jpg            # 封面1
├── article-2.md           # 文章2
└── cover-2.jpg            # 封面2
```

## 配置

编辑 `config/default.yaml`:

```yaml
# 搜索配置
search:
  sources:
    - weibo
    - xiaohongshu
    - twitter
    - bilibili
    - xueqiu
    - exa
  max_results: 10

# 文章生成
article:
  count: 2              # 每天生成文章数
  min_word_count: 2500
  max_word_count: 3500
  theme: "pie"          # 发布主题

# 定时任务
cron:
  enabled: true
  schedule: "0 9 * * *"
```

## 依赖

- Agent Reach (已配置 12+ 渠道)
- wechat-prompt-context (文章生成)
- wechat-toolkit (发布)
- wenyan-cli (公众号发布)

## 版本

- **v2.1** - 2026-04-05
  - 添加微博/知乎Cookie登录支持
  - 优化AI分析：并发5个评估，10个热点，提速34%
  - 文章生成：并行2篇，独立临时目录
  - 发布：串行执行，避免API限流
  - 封面：Pexels优先 + 豆包备选，修复YAML转义
  - 修复发布超时问题（3秒→300秒优化到4秒）
  
- v2.0 - 全自动版本，支持5大平台搜索
- v1.0 - 半自动版本，仅准备话题
