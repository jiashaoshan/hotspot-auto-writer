#!/usr/bin/env node
/**
 * 步骤3: 生成公众号文章
 * 调用 wechat-prompt-context 生成文章
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取分析后的话题
function loadTopics(dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, '../output', `${today}-topics.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`话题文件不存在: ${filePath}`);
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.topics || [];
}

// 主函数
async function main(dateStr) {
  const topics = loadTopics(dateStr);
  console.log(`📊 加载了 ${topics.length} 个话题`);
  
  console.log('\n📝 文章生成功能需要调用 wechat-prompt-context');
  console.log('   为了简化流程，建议使用 wenyan 命令直接发布\n');
  
  // 保存结果供后续使用
  const outputDir = path.join(__dirname, '../output');
  const today = dateStr || new Date().toISOString().split('T')[0];
  const resultPath = path.join(outputDir, `${today}-articles.json`);
  
  fs.writeFileSync(resultPath, JSON.stringify({
    date: today,
    timestamp: new Date().toISOString(),
    count: topics.length,
    topics: topics,
    note: '请使用 wenyan publish 命令发布文章'
  }, null, 2));
  
  console.log(`💾 话题已保存: ${resultPath}`);
  console.log('\n下一步：使用 wechat-prompt-context 生成文章');
  console.log('命令示例：');
  topics.forEach((t, i) => {
    console.log(`  ${i + 1}. wenyan generate -t "${t.title}" --type ${t.articleType}`);
  });
  
  return topics;
}

// CLI
if (require.main === module) {
  const dateStr = process.argv[2];
  main(dateStr)
    .then(() => {
      console.log('\n✅ 准备完成，请手动生成文章');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 失败:', err);
      process.exit(1);
    });
}

module.exports = { main };
