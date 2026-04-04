# 🔥 Hotspot Auto-Writer

全自动热点写作技能 - 从热点搜索到公众号发布的完整自动化工作流

## ✨ 功能特性

- **🔍 多平台热点聚合**：自动从 B站、小红书、Twitter 等平台搜索热门话题
- **🤖 AI智能评估**：基于5维评估框架自动筛选高质量话题
- **✍️ 自动生成文章**：调用 wechat-prompt-context 生成 3000 字深度文章
- **🚀 并行发布**：两篇文章同时发布到微信公众号草稿箱
- **⚡ 高效省时**：全流程约 9-12 分钟，无需人工干预

## 📋 工作流程

```
步骤1: Agent Reach 搜索热点
├─ B站热门: 10条
├─ 小红书热门: 5-8条
└─ Twitter趋势: 8条

步骤2: AI主编级评估
├─ 5条筛选标准（深度/观点/价值/时效/安全）
└─ 选出Top 2话题

步骤3: 串行生成文章
├─ 话题1: 调用 wechat-prompt-context 生成
└─ 话题2: 调用 wechat-prompt-context 生成

步骤4: 并行发布文章
├─ 文章1: 发布到公众号草稿箱
└─ 文章2: 发布到公众号草稿箱（并行）
```

## 🛠️ 实现方式

### 技术栈

- **运行时**: Node.js
- **热点搜索**: Agent Reach CLI (bili, xhs, twitter)
- **AI评估**: OpenClaw LLM + 自定义5维评估框架
- **文章生成**: wechat-prompt-context 技能
- **公众号发布**: wechat-mp-publisher 技能
- **并发执行**: async/await + Promise.all

### 核心架构

```
auto-write.js (主流程)
  ├─ fetchAllHotspots()    # 步骤1: 搜索热点
  ├─ analyzeAndSelect()    # 步骤2: AI评估
  ├─ generateArticles()    # 步骤3: 生成文章（串行）
  └─ publishArticles()     # 步骤4: 发布文章（并行）

config/prompts.js          # 评估框架配置
```

## 📦 依赖

### 必需技能

| 技能 | 用途 | 安装路径 |
|:---|:---|:---|
| wechat-prompt-context | 文章生成 | `~/.openclaw/workspace/skills/wechat-prompt-context` |
| wechat-mp-publisher | 公众号发布 | `~/.openclaw/workspace/skills/wechat-mp-publisher` |
| wechat-toolkit | 备选发布 | `~/.openclaw/workspace/skills/wechat-toolkit` |

### 必需 CLI 工具

| 工具 | 版本 | 用途 |
|:---|:---|:---|
| Agent Reach | latest | 热点搜索 (bili, xhs, twitter) |
| wenyan | 2.0.2 | 公众号发布 |
| @wenyan-md/core | 2.0.2 | wenyan依赖 |

### 环境变量

```bash
export WECHAT_APP_ID="your_app_id"
export WECHAT_APP_SECRET="your_app_secret"
```

## 🚀 安装

### 1. 克隆仓库

```bash
cd ~/.openclaw/workspace/skills
git clone https://github.com/yourusername/hotspot-auto-writer.git
cd hotspot-auto-writer
```

### 2. 安装依赖技能

```bash
# wechat-prompt-context
git clone https://github.com/yourusername/wechat-prompt-context.git \
  ~/.openclaw/workspace/skills/wechat-prompt-context

# wechat-mp-publisher
git clone https://github.com/yourusername/wechat-mp-publisher.git \
  ~/.openclaw/workspace/skills/wechat-mp-publisher
```

### 3. 配置环境变量

```bash
# 添加到 ~/.zshrc 或 ~/.bashrc
export WECHAT_APP_ID="wx43d98b327b62dcfa"
export WECHAT_APP_SECRET="your_secret"

# 立即生效
source ~/.zshrc
```

### 4. 安装 wenyan-cli

```bash
npm install -g @wenyan-md/cli@2.0.2

# 降级 core 库到兼容版本
cd ~/.npm-global/lib/node_modules/@wenyan-md/cli
npm install @wenyan-md/core@2.0.2
```

### 5. 安装 Agent Reach

```bash
# 参考 Agent Reach 官方文档安装
# https://github.com/panniantong/agent-reach
```

## 💻 使用

### 手动运行

```bash
cd ~/.openclaw/workspace/skills/hotspot-auto-writer

# 自动模式（跳过确认）
node scripts/auto-write.js --auto

# 手动模式（需要确认）
node scripts/auto-write.js
```

### 定时任务

```bash
# 添加 cron 任务（每天上午9点运行）
crontab -e

# 添加以下行
0 9 * * * cd ~/.openclaw/workspace/skills/hotspot-auto-writer && node scripts/auto-write.js --auto >> cron.log 2>&1
```

## ⚙️ 配置

### 评估框架配置

编辑 `config/prompts.js` 修改话题评估标准：

```javascript
// 5条筛选标准
const evaluationCriteria = {
  depth: "能否支撑2500-3000字深度文章",
  opinion: "是否有独特观点或分析角度",
  value: "对目标读者是否有认知/情绪/实用价值",
  timeliness: "热点时效是否适中（48-72小时）",
  safety: "是否有政治/法律/舆论风险"
};
```

### 渠道配置

编辑 `scripts/auto-write.js` 修改搜索渠道：

```javascript
// 当前支持的渠道
const channels = [
  { name: 'B站', command: 'bili hot', enabled: true },
  { name: '小红书', command: 'xhs hot', enabled: true },
  { name: 'Twitter', command: 'twitter feed', enabled: true }
];
```

## 📁 输出结构

```
output/
└── 2026-04-04/
    ├── article-1.md       # 文章1正文
    ├── article-2.md       # 文章2正文
    ├── cover-1.jpg        # 文章1封面
    ├── cover-2.jpg        # 文章2封面
    ├── articles.json      # 生成元数据
    └── hotspots.json      # 热点原始数据
```

## 🔧 故障排除

### 发布失败

**症状**: 脚本显示成功但草稿箱没有文章

**解决**:
1. 检查 IP 是否在公众号白名单
2. 检查 WECHAT_APP_ID 和 WECHAT_APP_SECRET 是否正确
3. 确认 wenyan-cli 版本为 2.0.2

### 热点搜索失败

**症状**: 某个渠道返回 0 条热点

**解决**:
1. 检查对应平台的 cookie 是否过期
2. 检查网络连接
3. 尝试单独运行对应命令（如 `bili hot`）

### 文章生成超时

**症状**: 步骤3卡住超过 10 分钟

**解决**:
1. 检查 wechat-prompt-context 是否正常工作
2. 增加超时时间（修改 `run()` 函数的 timeout 参数）

## 📊 性能指标

| 指标 | 数值 |
|:---|:---|
| 热点搜索 | ~1 分钟 |
| AI评估 | ~1 分钟 |
| 文章生成 | ~10 分钟（串行） |
| 文章发布 | ~2 分钟（并行） |
| **总计** | **~12 分钟** |

## 🤝 依赖项目

- [Agent Reach](https://github.com/panniantong/agent-reach) - 互联网内容聚合
- [wechat-prompt-context](https://github.com/yourusername/wechat-prompt-context) - 公众号文章生成
- [wenyan-cli](https://github.com/caol64/wenyan-cli) - 公众号发布工具

## 📝 更新日志

### v2.0.0 (2026-04-04)

- ✅ 修复 wenyan-cli 版本兼容问题
- ✅ 添加发布并行执行（节省50%时间）
- ✅ 优化5维话题评估框架
- ✅ 添加自动确认模式（--auto）
- ✅ 修复 @wenyan-md/core 降级问题

### v1.0.0 (2026-04-01)

- 🎉 初始版本发布
- 支持 B站/小红书/Twitter 热点搜索
- 支持自动生成和发布文章

## 📄 License

MIT License © 2026 Yang Yanqing
