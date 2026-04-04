#!/usr/bin/env node
/**
 * 显示 Agent Reach 搜索到的热点
 */

const { execSync } = require('child_process');

function run(cmd, timeout = 30000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
  } catch (e) {
    return null;
  }
}

console.log('\n🔥 Agent Reach 热点搜索测试\n');

// 1. B站热门
console.log('📺 B站热门:');
const bili = run('bili hot 2>/dev/null | head -15');
if (bili) {
  console.log(bili);
} else {
  console.log('   ⚠️ 无法获取\n');
}

// 2. Twitter 趋势
console.log('\n🐦 Twitter 趋势:');
const twitter = run('twitter trends 2>/dev/null | head -15');
if (twitter) {
  console.log(twitter);
} else {
  console.log('   ⚠️ 无法获取\n');
}

// 3. 使用 Exa 搜索
console.log('\n🔍 全网热点 (Exa):');
const exa = run('agent-reach search "今日热点" --source exa 2>/dev/null | head -20');
if (exa) {
  console.log(exa);
} else {
  console.log('   ⚠️ 无法获取\n');
}

console.log('\n✅ 搜索完成');
