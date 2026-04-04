#!/bin/bash
# 安装定时任务

echo "安装热点自动写作定时任务..."

# 创建日志目录
mkdir -p ~/.openclaw/logs

# 获取当前技能的绝对路径
SKILL_PATH="$(cd "$(dirname "$0")/.." && pwd)"

# 创建 crontab 条目
CRON_ENTRY="0 9 * * * /bin/bash -c 'export PATH=\"\$HOME/.local/bin:\$PATH\" && export TWITTER_AUTH_TOKEN=\"${TWITTER_AUTH_TOKEN}\" && export TWITTER_CT0=\"${TWITTER_CT0}\" && cd \"${SKILL_PATH}\" && node scripts/main.js' >> ~/.openclaw/logs/hotspot-auto-writer.log 2>&1"

# 添加到 crontab
(crontab -l 2>/dev/null | grep -v "hotspot-auto-writer"; echo "$CRON_ENTRY") | crontab -

echo "✅ 定时任务已安装"
echo "执行时间: 每天 9:00"
echo "日志文件: ~/.openclaw/logs/hotspot-auto-writer.log"
echo ""
echo "查看定时任务:"
crontab -l | grep hotspot-auto-writer
