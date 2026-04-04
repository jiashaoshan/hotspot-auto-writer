#!/usr/bin/env node
/**
 * 全自动热点写作 - Agent Reach CLI 版本
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

path.expanduser = function(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
};

function run(cmd, timeout = 60000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });
  } catch (e) {
    console.log(`      ⚠️ 命令失败`);
    return null;
  }
}

async function fetchAllHotspots() {
  console.log('\n🔥 步骤1: Agent Reach 全渠道搜索热点\n');
  
  const allHotspots = [];
  
  // 1. B站热门
  console.log('   📺 B站热门...');
  try {
    const result = run('bili hot', 30000);
    if (result) {
      const lines = result.split('\n');
      let inItems = false, currentItem = {}, count = 0;
      for (const line of lines) {
        if (line.includes('items:')) inItems = true;
        if (inItems && line.trim().startsWith('- id:')) {
          if (currentItem.title && count < 10) {
            allHotspots.push({ platform: 'B站', title: currentItem.title, hot: currentItem.view || 50, category: '热门视频' });
            count++;
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
      if (currentItem.title && count < 10) {
        allHotspots.push({ platform: 'B站', title: currentItem.title, hot: currentItem.view || 50, category: '热门视频' });
      }
      console.log(`      ✅ ${count} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 2. 小红书
  console.log('   📕 小红书热门...');
  try {
    const result = run('xhs hot 2>/dev/null || xhs feed 2>/dev/null', 30000);
    if (result) {
      try {
        const data = JSON.parse(result);
        if (Array.isArray(data)) {
          data.slice(0, 8).forEach((item, idx) => {
            allHotspots.push({
              platform: '小红书',
              title: item.title || item.desc?.slice(0, 50) || '热门笔记',
              hot: item.likes || item.comments || 80 - idx * 5,
              category: '热门笔记'
            });
          });
          console.log(`      ✅ ${Math.min(data.length, 8)} 条`);
        }
      } catch (e) {
        const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('{')).slice(0, 5);
        lines.forEach((line, idx) => {
          allHotspots.push({ platform: '小红书', title: line.slice(0, 50), hot: 70 - idx * 5, category: '热门笔记' });
        });
        console.log(`      ✅ ${lines.length} 条`);
      }
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 3. Twitter
  console.log('   🐦 Twitter 趋势...');
  try {
    const result = run('twitter feed -n 10 2>/dev/null', 30000);
    if (result) {
      const lines = result.split('\n').filter(l => l.trim() && l.length > 10).slice(0, 8);
      lines.forEach((line, idx) => {
        allHotspots.push({ platform: 'Twitter', title: line.slice(0, 60), hot: 85 - idx * 5, category: 'Trending' });
      });
      console.log(`      ✅ ${lines.length} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 4. V2EX
  console.log('   💬 V2EX 热门...');
  try {
    const result = run('curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"', 30000);
    if (result) {
      const data = JSON.parse(result);
      if (Array.isArray(data)) {
        data.slice(0, 8).forEach((item, idx) => {
          allHotspots.push({
            platform: 'V2EX',
            title: item.title,
            hot: item.replies * 10 || 80 - idx * 5,
            category: item.node_title || '技术'
          });
        });
        console.log(`      ✅ ${Math.min(data.length, 8)} 条`);
      }
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 5. Reddit
  console.log('   🔴 Reddit 热门...');
  try {
    const result = run('rdt popular --limit 10 2>/dev/null', 30000);
    if (result) {
      const lines = result.split('\n').filter(l => l.trim() && l.includes('|')).slice(0, 8);
      lines.forEach((line, idx) => {
        allHotspots.push({ platform: 'Reddit', title: line.slice(0, 60), hot: 75 - idx * 5, category: '热门' });
      });
      console.log(`      ✅ ${lines.length} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 6. 微博
  console.log('   📱 微博热搜...');
  try {
    const result = run('curl -s "https://r.jina.ai/https://tophub.today/n/KqndgxeLl9" 2>/dev/null | head -20', 30000);
    if (result) {
      const lines = result.split('\n').filter(l => l.trim() && l.match(/^\d+\./)).slice(0, 8);
      lines.forEach((line, idx) => {
        const match = line.match(/^\d+\.\s*(.+)/);
        if (match) {
          allHotspots.push({ platform: '微博', title: match[1].slice(0, 50), hot: 90 - idx * 5, category: '热搜' });
        }
      });
      console.log(`      ✅ ${lines.length} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  console.log(`\n   📊 共收集 ${allHotspots.length} 条热点`);
  
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  fs.writeFileSync(
    path.join(outputDir, 'hotspots.json'),
    JSON.stringify({ date: today, count: allHotspots.length, hotspots: allHotspots }, null, 2)
  );
  
  return allHotspots;
}

async function analyzeTopics(hotspots) {
  console.log('\n🤖 步骤2: AI分析选出 Top 2 话题\n');
  
  if (hotspots.length === 0) {
    console.log('   ⚠️ 没有热点数据，使用默认话题');
    return [
      { rank: 1, title: 'AI时代的内容创作新趋势', source: '默认', angle: '深度分析', articleType: 'opinion', targetAudience: '内容创作者', sellingPoint: 'AI如何改变创作', why: '通用话题' },
      { rank: 2, title: '职场人的时间管理困境', source: '默认', angle: '观点分析', articleType: 'opinion', targetAudience: '职场人', sellingPoint: '解决时间焦虑', why: '通用话题' }
    ];
  }
  
  const prompt = `作为资深内容策划，从以下热点中选出2个最适合公众号深度文章的选题：

${hotspots.slice(0, 20).map((h, i) => `${i + 1}. [${h.platform}] ${h.title}`).join('\n')}

选择标准：
1. 有深度，能写2500-3000字
2. 有观点性，不是纯新闻
3. 对读者有价值
4. 避开敏感话题

输出JSON格式：
{
  "topics": [
    {"rank": 1, "title": "文章标题", "source": "来源平台", "angle": "切入角度", "articleType": "opinion/analysis/story", "targetAudience": "目标读者", "sellingPoint": "核心卖点", "why": "选择理由"},
    {"rank": 2, ...}
  ]
}

只输出JSON：`;

  try {
    console.log('   → 调用AI分析...');
    const cmd = `openclaw agent --agent creator -m '${prompt.replace(/'/g, "'\"'\"'")}' --json --timeout 180`;
    const result = run(cmd, 200000);
    
    if (!result) throw new Error('AI调用失败');
    
    let response = '';
    try {
      const parsed = JSON.parse(result);
      if (parsed.result?.payloads?.length > 0) {
        response = parsed.result.payloads.map(p => p.text || '').join('\n');
      } else if (parsed.text) {
        response = parsed.text;
      }
    } catch (e) {
      response = result;
    }
    
    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    
    const topics = parsed.topics || parsed;
    console.log(`   ✅ 选出 ${topics.length} 个话题\n`);
    
    topics.forEach(t => {
      console.log(`   ${t.rank}. ${t.title}`);
      console.log(`      类型: ${t.articleType} | 角度: ${t.angle}`);
    });
    
    const today = new Date().toISOString().split('T')[0];
    const outputDir = path.join(__dirname, '../output', today);
    fs.writeFileSync(
      path.join(outputDir, 'topics.json'),
      JSON.stringify({ date: today, topics }, null, 2)
    );
    
    return topics;
  } catch (e) {
    console.log('   ⚠️ AI分析失败，使用默认话题');
    return [
      { rank: 1, title: 'AI时代的内容创作新趋势', source: '默认', angle: '深度分析', articleType: 'opinion', targetAudience: '内容创作者', sellingPoint: 'AI如何改变创作', why: '通用话题' },
      { rank: 2, title: '职场人的时间管理困境', source: '默认', angle: '观点分析', articleType: 'opinion', targetAudience: '职场人', sellingPoint: '解决时间焦虑', why: '通用话题' }
    ];
  }
}

function confirmWithUser(topics) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  return new Promise((resolve) => {
    console.log('\n' + '='.repeat(60));
    console.log('🛑 【用户确认环节】');
    console.log('='.repeat(60));
    console.log('\nAI已选出以下2个话题准备生成文章：\n');
    
    topics.forEach(t => {
      console.log(`${t.rank}. ${t.title}`);
      console.log(`   来源: ${t.source} | 类型: ${t.articleType}`);
      console.log(`   角度: ${t.angle}`);
      console.log(`   卖点: ${t.sellingPoint}`);
      console.log(`   理由: ${t.why}\n`);
    });
    
    rl.question('请选择：\n  [yes/y] - 继续生成文章\n  [skip/s] - 跳过生成\n  [quit/q] - 退出\n\n你的选择: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 热点自动写作 (Agent Reach CLI版)');
  console.log('='.repeat(60));
  
  const hotspots = await fetchAllHotspots();
  const topics = await analyzeTopics(hotspots);
  const choice = await confirmWithUser(topics);
  
  if (choice === 'quit' || choice === 'q') {
    console.log('\n👋 已退出');
    return;
  }
  
  if (choice === 'skip' || choice === 's') {
    console.log('\n⏭️ 已跳过文章生成');
    return;
  }
  
  console.log('\n✅ 继续生成文章...');
  console.log('\n📋 请使用以下命令生成文章：');
  
  const wpcPath = '~/.openclaw/workspace/skills/wechat-prompt-context';
  topics.forEach(t => {
    console.log(`\n  话题 ${t.rank}: ${t.title}`);
    console.log(`  命令: node ${wpcPath}/scripts/main.js --topic="${t.title}" --type=${t.articleType} --theme=pie`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 流程完成！请执行上述命令生成文章。');
  console.log('='.repeat(60) + '\n');
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
