#!/usr/bin/env node
/**
 * 热点自动写作 - 主入口 (全自动版)
 * 完整流程: Agent Reach全渠道搜索 → AI分析 → wechat-prompt-context生成 → 发布
 */

const { execSync } = require('child_process');
const path = require('path');

async function main() {
  console.log('🔥 热点自动写作 (全自动版)\n');
  
  try {
    // 直接调用全自动脚本
    execSync(`node "${__dirname}/auto-write.js"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('\n❌ 流程失败:', err.message);
    process.exit(1);
  }
}

main();
