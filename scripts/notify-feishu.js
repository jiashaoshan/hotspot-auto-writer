#!/usr/bin/env node
/**
 * 步骤4: 发送飞书通知
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取话题数据
function loadTopics(dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, '../output', `${today}-topics.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`话题文件不存在: ${filePath}`);
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.topics || [];
}

// 发送飞书通知
async function sendNotification(topics, dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  
  // 构建消息内容
  let message = `🔥 **今日热点自动写作 - ${today}**\n\n`;
  message += `📊 已为你选出 **${topics.length}** 个适合公众号写作的热点话题\n\n`;
  message += `---\n\n`;
  
  topics.forEach((t, i) => {
    message += `**${i + 1}. ${t.title}**\n`;
    message += `• 类型: ${t.articleType} | 角度: ${t.angle}\n`;
    message += `• 目标读者: ${t.targetAudience}\n`;
    message += `• 核心卖点: ${t.sellingPoint}\n`;
    message += `• 选择理由: ${t.why}\n\n`;
    message += `**生成命令:**\n`;
    message += "```\n";
    message += `wenyan generate -t "${t.title}" --type ${t.articleType}\n`;
    message += "```\n\n";
    message += `---\n\n`;
  });
  
  message += `💡 **下一步操作:**\n`;
  message += `1. 选择感兴趣的话题\n`;
  message += `2. 复制对应的生成命令\n`;
  message += `3. 执行后按提示确认/修改\n`;
  message += `4. 文章将自动发布到公众号草稿箱\n\n`;
  message += `📁 **输出文件:**\n`;
  message += `- 热点数据: ${today}-hotspots.json\n`;
  message += `- 话题分析: ${today}-topics.json\n`;
  message += `- 文章目录: output/${today}/\n`;
  
  // 使用 OpenClaw 的 message 工具发送
  // 注意: 这里使用 sessions_send 或直接输出到控制台
  // 实际部署时需要配置飞书 webhook
  
  console.log('📱 飞书通知内容:\n');
  console.log(message);
  console.log('\n💾 消息已保存到:', path.join(__dirname, '../output', `${today}-notification.txt`));
  
  // 保存消息到文件
  fs.writeFileSync(
    path.join(__dirname, '../output', `${today}-notification.txt`),
    message,
    'utf8'
  );
  
  // 如果有配置飞书 webhook，可以在这里调用
  // const webhook = process.env.FEISHU_WEBHOOK;
  // if (webhook) { ... }
  
  return message;
}

// 主函数
async function main(dateStr) {
  const topics = loadTopics(dateStr);
  await sendNotification(topics, dateStr);
  console.log('\n✅ 飞书通知已准备');
}

// CLI
if (require.main === module) {
  const dateStr = process.argv[2];
  main(dateStr)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ 通知失败:', err);
      process.exit(1);
    });
}

module.exports = { sendNotification };
