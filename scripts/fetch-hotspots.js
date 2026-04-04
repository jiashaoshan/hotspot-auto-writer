#!/usr/bin/env node
/**
 * 步骤1: 通过 Agent Reach 搜索全网热点
 */

const { execSync } = require('child_process');
const path = require('path');

// 执行 Agent Reach 命令
function agentReach(command, timeout = 30000) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      }
    });
    return JSON.parse(result);
  } catch (e) {
    console.error(`  ⚠️ 命令失败: ${command}`);
    console.error(`     错误: ${e.message}`);
    return null;
  }
}

// 搜索微博热搜
async function searchWeibo() {
  console.log('🔍 搜索微博热搜...');
  try {
    // 使用 mcporter 调用 weibo
    const result = execSync('mcporter call weibo.get_hot_search()', {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
    const data = JSON.parse(result);
    if (data && data.data) {
      const hotspots = data.data.slice(0, 10).map(item => ({
        platform: 'weibo',
        title: item.word || item.title,
        hot: item.raw_hot || item.hot,
        url: item.url || `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word)}`,
        category: item.category
      }));
      console.log(`   ✅ 找到 ${hotspots.length} 条微博热搜`);
      return hotspots;
    }
  } catch (e) {
    console.log('   ⚠️ 微博搜索失败:', e.message);
  }
  return [];
}

// 搜索B站热门
async function searchBilibili() {
  console.log('🔍 搜索B站热门...');
  try {
    const result = execSync('bili hot', {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
    const lines = result.split('\n').filter(l => l.trim() && !l.includes('正在获取'));
    const hotspots = lines.slice(0, 10).map((line, idx) => ({
      platform: 'bilibili',
      title: line.replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim(),
      hot: 100 - idx * 10,
      url: '',
      category: '热门'
    }));
    console.log(`   ✅ 找到 ${hotspots.length} 条B站热门`);
    return hotspots;
  } catch (e) {
    console.log('   ⚠️ B站搜索失败:', e.message);
    return [];
  }
}

// 搜索小红书热门
async function searchXiaohongshu() {
  console.log('🔍 搜索小红书热门...');
  try {
    // 使用 xhs-cli 搜索热门
    const result = execSync('xhs search "热门" --limit 10', {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
    // 解析结果
    const lines = result.split('\n').filter(l => l.trim());
    const hotspots = lines.slice(0, 10).map((line, idx) => ({
      platform: 'xiaohongshu',
      title: line.replace(/^\d+\.\s*/, '').trim(),
      hot: 100 - idx * 10,
      url: '',
      category: '热门'
    }));
    console.log(`   ✅ 找到 ${hotspots.length} 条小红书热门`);
    return hotspots;
  } catch (e) {
    console.log('   ⚠️ 小红书搜索失败:', e.message);
    return [];
  }
}

// 搜索 Twitter 趋势
async function searchTwitter() {
  console.log('🔍 搜索 Twitter 趋势...');
  try {
    const result = execSync('twitter trends', {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
        TWITTER_AUTH_TOKEN: process.env.TWITTER_AUTH_TOKEN,
        TWITTER_CT0: process.env.TWITTER_CT0
      }
    });
    // 解析趋势
    const lines = result.split('\n').filter(l => l.includes('#') || l.includes(' trending '));
    const hotspots = lines.slice(0, 10).map((line, idx) => ({
      platform: 'twitter',
      title: line.replace(/^\d+\.\s*/, '').trim(),
      hot: 100 - idx * 10,
      url: '',
      category: 'Trending'
    }));
    console.log(`   ✅ 找到 ${hotspots.length} 条 Twitter 趋势`);
    return hotspots;
  } catch (e) {
    console.log('   ⚠️ Twitter 搜索失败:', e.message);
    return [];
  }
}

// 全网搜索 (Exa)
async function searchExa() {
  console.log('🔍 全网搜索 (Exa)...');
  try {
    const result = execSync('mcporter call exa.search({"query": "今日热点 热门话题", "numResults": 10})', {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
    const data = JSON.parse(result);
    if (data && data.results) {
      const hotspots = data.results.slice(0, 10).map((item, idx) => ({
        platform: 'exa',
        title: item.title || item.text?.slice(0, 50),
        hot: 90 - idx * 5,
        url: item.url,
        category: '全网'
      }));
      console.log(`   ✅ 找到 ${hotspots.length} 条全网热点`);
      return hotspots;
    }
  } catch (e) {
    console.log('   ⚠️ Exa 搜索失败:', e.message);
  }
  return [];
}

// 搜索雪球热股
async function searchXueqiu() {
  console.log('🔍 搜索雪球热股...');
  try {
    const result = execSync('mcporter call xueqiu.get_hot_stocks()', {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
    const data = JSON.parse(result);
    if (data && data.data) {
      const hotspots = data.data.slice(0, 5).map(item => ({
        platform: 'xueqiu',
        title: `${item.name}(${item.symbol}): ${item.hot_reason || '热股'}`,
        hot: item.hot_rank || 50,
        url: `https://xueqiu.com/S/${item.symbol}`,
        category: '财经'
      }));
      console.log(`   ✅ 找到 ${hotspots.length} 条雪球热股`);
      return hotspots;
    }
  } catch (e) {
    console.log('   ⚠️ 雪球搜索失败:', e.message);
  }
  return [];
}

// 主函数：收集所有热点
async function fetchHotspots() {
  console.log('\n🔥 开始收集全网热点...\n');
  
  const allHotspots = [];
  
  // 并行搜索所有渠道
  const results = await Promise.allSettled([
    searchWeibo(),
    searchXiaohongshu(),
    searchTwitter(),
    searchExa(),
    searchXueqiu()
  ]);
  
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value) {
      allHotspots.push(...result.value);
    }
  });
  
  console.log(`\n📊 共收集到 ${allHotspots.length} 条热点`);
  
  // 去重（按标题相似度）
  const uniqueHotspots = allHotspots.filter((item, index, self) =>
    index === self.findIndex(t => 
      t.title.toLowerCase().includes(item.title.toLowerCase()) ||
      item.title.toLowerCase().includes(t.title.toLowerCase())
    )
  );
  
  console.log(`📊 去重后剩余 ${uniqueHotspots.length} 条热点\n`);
  
  // 按热度排序
  uniqueHotspots.sort((a, b) => (b.hot || 0) - (a.hot || 0));
  
  return uniqueHotspots;
}

// 保存结果
function saveHotspots(hotspots) {
  const outputDir = path.join(__dirname, '../output');
  if (!require('fs').existsSync(outputDir)) {
    require('fs').mkdirSync(outputDir, { recursive: true });
  }
  
  const today = new Date().toISOString().split('T')[0];
  const filePath = path.join(outputDir, `${today}-hotspots.json`);
  
  require('fs').writeFileSync(filePath, JSON.stringify({
    date: today,
    timestamp: new Date().toISOString(),
    count: hotspots.length,
    hotspots: hotspots
  }, null, 2));
  
  console.log(`💾 热点已保存: ${filePath}`);
  return filePath;
}

// CLI
if (require.main === module) {
  fetchHotspots()
    .then(hotspots => {
      saveHotspots(hotspots);
      console.log('\n✅ 热点收集完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 热点收集失败:', err);
      process.exit(1);
    });
}

module.exports = { fetchHotspots, saveHotspots };
