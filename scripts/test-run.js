#!/usr/bin/env node
/**
 * 热点自动写作 - 测试运行版
 * 使用直接可用的工具搜索热点
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 执行命令
function run(cmd, timeout = 60000) {
  try {
    console.log(`   执行: ${cmd.slice(0, 80)}...`);
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      }
    });
  } catch (e) {
    console.log(`   ⚠️ 失败: ${e.message.slice(0, 100)}`);
    return null;
  }
}

// 步骤1: 搜索热点
async function fetchHotspots() {
  console.log('\n🔥 步骤1: 搜索全网热点\n');
  
  const hotspots = [];
  
  // 1. B站热门 (bili-cli 可用)
  console.log('   搜索B站热门...');
  try {
    const result = run('bili hot', 30000);
    if (result) {
      const lines = result.split('\n').filter(l => l.trim() && /^\d+\./.test(l));
      lines.slice(0, 10).forEach((line, idx) => {
        hotspots.push({
          platform: 'B站',
          title: line.replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim(),
          hot: 100 - idx * 10,
          category: '热门视频'
        });
      });
      console.log(`      ✅ ${Math.min(lines.length, 10)} 条`);
    }
  } catch (e) {
    console.log('      ⚠️ B站搜索失败');
  }
  
  // 2. 使用 tavily 搜索全网热点
  console.log('   搜索全网热点...');
  try {
    const searchTerms = ['今日热点', '热门话题', '微博热搜'];
    for (const term of searchTerms.slice(0, 1)) {
      const result = run(`web_search "${term}" 5`, 30000);
      if (result) {
        try {
          const data = JSON.parse(result);
          if (data.results) {
            data.results.slice(0, 5).forEach((r, idx) => {
              hotspots.push({
                platform: '全网',
                title: r.title || r.snippet?.slice(0, 50) || '热点',
                hot: 90 - idx * 5,
                category: '搜索',
                url: r.url
              });
            });
            console.log(`      ✅ ${Math.min(data.results.length, 5)} 条`);
          }
        } catch (e) {
          // 解析失败，尝试行解析
          const lines = result.split('\n').filter(l => l.includes('http'));
          lines.slice(0, 5).forEach((line, idx) => {
            hotspots.push({
              platform: '全网',
              title: line.slice(0, 60),
              hot: 80 - idx * 5,
              category: '搜索'
            });
          });
        }
      }
    }
  } catch (e) {
    console.log('      ⚠️ 全网搜索失败');
  }
  
  // 3. 使用 Tavily MCP 如果可用
  console.log('   尝试 Tavily 搜索...');
  try {
    const result = run('mcporter call tavily.search 2>&1 | head -20 || echo "Tavily not available"', 15000);
    if (result && !result.includes('not available') && !result.includes('Unknown')) {
      console.log('      ✅ Tavily 可用');
    } else {
      console.log('      ⚠️ Tavily 暂不可用');
    }
  } catch (e) {
    console.log('      ⚠️ Tavily 未配置');
  }
  
  console.log(`\n   📊 共收集 ${hotspots.length} 条热点`);
  
  // 保存
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  fs.writeFileSync(
    path.join(outputDir, 'hotspots.json'),
    JSON.stringify({ date: today, count: hotspots.length, hotspots }, null, 2)
  );
  
  return hotspots;
}

// 步骤2: AI分析
async function analyzeTopics(hotspots) {
  console.log('\n🤖 步骤2: AI分析选出话题\n');
  
  if (hotspots.length === 0) {
    console.log('   ⚠️ 没有热点数据，使用默认话题');
    return [
      { rank: 1, title: 'AI时代的内容创作新趋势', source: '默认', angle: '深度分析', articleType: 'opinion', targetAudience: '内容创作者', sellingPoint: 'AI如何改变创作', why: '通用话题' },
      { rank: 2, title: '职场人的时间管理困境', source: '默认', angle: '观点分析', articleType: 'opinion', targetAudience: '职场人', sellingPoint: '解决时间焦虑', why: '通用话题' }
    ];
  }
  
  const prompt = `作为资深内容策划，从以下热点中选出2个最适合公众号深度文章的选题：

${hotspots.slice(0, 15).map((h, i) => `${i + 1}. [${h.platform}] ${h.title}`).join('\n')}

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
    
    // 保存
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

// 用户确认
function confirmWithUser(topics) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    console.log('\n' + '='.repeat(60));
    console.log('🛑 【用户确认环节】');
    console.log('='.repeat(60));
    console.log('\nAI已选出以下话题准备生成文章：\n');
    
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

// 主函数
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 热点自动写作 - 测试运行');
  console.log('='.repeat(60));
  
  // 步骤1
  const hotspots = await fetchHotspots();
  
  // 步骤2
  const topics = await analyzeTopics(hotspots);
  
  // 步骤3: 用户确认
  const choice = await confirmWithUser(topics);
  
  if (choice === 'quit' || choice === 'q') {
    console.log('\n👋 已退出');
    return;
  }
  
  if (choice === 'skip' || choice === 's') {
    console.log('\n⏭️ 已跳过文章生成');
    console.log('\n✅ 流程完成（仅搜索和分析）');
    return;
  }
  
  // 继续生成
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
