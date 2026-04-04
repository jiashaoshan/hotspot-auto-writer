#!/usr/bin/env node
const { execSync } = require('child_process');

function run(cmd, timeout = 30000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } });
  } catch (e) { return null; }
}

console.log('\n🔥 Agent Reach 渠道测试\n');

const hotspots = [];

// B站 - 解析 YAML 格式
console.log('📺 B站热门:');
const bili = run('bili hot');
if (bili) {
  // YAML格式解析
  const lines = bili.split('\n');
  let inItems = false;
  let currentItem = {};
  
  for (const line of lines) {
    if (line.includes('items:')) inItems = true;
    if (inItems && line.trim().startsWith('- id:')) {
      if (currentItem.title) {
        hotspots.push({ platform: 'B站', title: currentItem.title, hot: currentItem.view || 50 });
      }
      currentItem = {};
    }
    if (inItems && line.includes('title:')) {
      const match = line.match(/title:\s*(.+)/);
      if (match) currentItem.title = match[1].trim();
    }
    if (inItems && line.includes('view:')) {
      const match = line.match(/view:\s*(\d+)/);
      if (match) currentItem.view = parseInt(match[1]);
    }
  }
  // 最后一个
  if (currentItem.title) {
    hotspots.push({ platform: 'B站', title: currentItem.title, hot: currentItem.view || 50 });
  }
  
  // 显示前5条
  const biliItems = hotspots.filter(h => h.platform === 'B站').slice(0, 5);
  biliItems.forEach((item, i) => {
    console.log(`  ${i+1}. ${item.title.slice(0, 50)}`);
  });
}

// Twitter - 使用 search
console.log('\n🐦 Twitter 搜索:');
const twitter = run('twitter search "trending" --limit 5 2>/dev/null');
if (twitter) {
  const lines = twitter.split('\n').filter(l => l.includes('@') || l.includes('#')).slice(0, 5);
  lines.forEach((line, i) => {
    console.log(`  ${i+1}. ${line.slice(0, 50)}`);
    hotspots.push({ platform: 'Twitter', title: line.slice(0, 60), hot: 90-i*5 });
  });
} else { console.log('  无法获取'); }

// Web 搜索
console.log('\n🔍 Web 热点:');
const web = run('web_search "今日热点" 3 2>/dev/null || echo "no"');
if (web && !web.includes('no')) {
  const lines = web.split('\n').slice(0, 3);
  lines.forEach((line, i) => {
    console.log(`  ${i+1}. ${line.slice(0, 50)}`);
    hotspots.push({ platform: 'Web', title: line.slice(0, 60), hot: 80-i*5 });
  });
} else { console.log('  无法获取'); }

console.log(`\n📊 共 ${hotspots.length} 条热点`);
hotspots.forEach((h, i) => console.log(`${i+1}. [${h.platform}] ${h.title.slice(0,40)}`));
