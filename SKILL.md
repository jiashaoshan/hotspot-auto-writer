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
步骤1: Agent Reach 全渠道搜索
    ├── 微博热搜 (weibo)
    ├── 小红书热门 (xiaohongshu)
    ├── Twitter 趋势 (twitter)
    ├── B站热门 (bilibili)
    ├── 雪球热股 (xueqiu)
    └── 全网搜索 (Exa)
    ↓
步骤2: AI 智能分析
    ├── 聚合所有渠道热点
    ├── 评估热度/深度/时效性
    └── 选出 Top 2 最适合公众号的话题
    ↓
步骤3: 自动生成文章
    ├── 调用 wechat-prompt-context
    ├── 自动生成提示词
    ├── LLM撰写文章 (2500-3000字)
    └── 生成AI封面图
    ↓
步骤4: 自动发布
    └── 保存到公众号草稿箱 (pie主题)
    ↓
步骤5: 飞书通知
    └── 发送完成通知和文章预览
```

## 已配置渠道 (6大平台)

| 渠道 | 平台 | 搜索内容 | 状态 |
|------|------|----------|------|
| 1 | 微博 | 热搜榜 | ✅ |
| 2 | 小红书 | 热门笔记 | ✅ |
| 3 | Twitter/X | 趋势话题 | ✅ |
| 4 | B站 | 热门视频 | ✅ |
| 5 | 雪球 | 热股讨论 | ✅ |
| 6 | Exa | 全网热点文章 | ✅ |

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

- v2.0 - 全自动版本，支持6大平台搜索
- v1.0 - 半自动版本，仅准备话题
