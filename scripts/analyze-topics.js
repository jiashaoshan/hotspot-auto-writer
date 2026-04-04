#!/usr/bin/env node
/**
 * 步骤2: AI 分析热点，选出最适合公众号写作的 Top 2 话题
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取热点数据
function loadHotspots(dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, '../output', `${today}-hotspots.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`热点文件不存在: ${filePath}`);
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.hotspots || [];
}

// 调用笔杆子 agent 分析
async function analyzeTopics(hotspots) {
  console.log('\n🤖 AI 分析热点...\n');
  
  // 构建分析提示词
  const prompt = `你是一位资深内容策划，擅长从全网热点中筛选出最适合微信公众号写作的选题。

以下是今日收集到的全网热点（共${hotspots.length}条）：

${hotspots.slice(0, 20).map((h, i) => `${i + 1}. [${h.platform}] ${h.title} (热度: ${h.hot})`).join('\n')}

请从以上热点中，选出2个最适合微信公众号深度文章的选题。

选择标准：
1. 话题有足够深度，能写出2500-3000字
2. 有观点性、分析性，不是纯新闻
3. 对读者有价值，能引发思考
4. 时效性适中，不会明天就过时
5. 避开敏感政治话题

输出JSON格式：
{
  "topics": [
    {
      "rank": 1,
      "title": "文章主题（吸引人的标题）",
      "source": "来自哪个热点",
      "angle": "切入角度",
      "articleType": "文章类型（story/analysis/list/opinion）",
      "targetAudience": "目标读者",
      "sellingPoint": "核心卖点/钩子",
      "why": "选择理由（2-3句话）"
    },
    {
      "rank": 2,
      ...
    }
  ]
}

只输出JSON，不要其他文字。`;

  // 保存提示词
  const tempDir = path.join(__dirname, '../output');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const promptPath = path.join(tempDir, 'analyze_topics_prompt.txt');
  fs.writeFileSync(promptPath, prompt, 'utf8');
  
  // 调用笔杆子 agent
  try {
    console.log('   → 调用笔杆子 agent...');
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    const openclawCmd = `openclaw agent --agent creator -m '${promptContent.replace(/'/g, "'\"'\"'")}' --json --timeout 300`;
    
    const result = execSync(openclawCmd, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000
    });
    
    // 解析结果
    let response = '';
    try {
      const parsed = JSON.parse(result);
      if (parsed.result && parsed.result.payloads && parsed.result.payloads.length > 0) {
        response = parsed.result.payloads.map(p => p.text || '').join('\n');
      } else if (parsed.text) {
        response = parsed.text;
      }
    } catch (e) {
      response = result;
    }
    
    // 提取JSON
    let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('   ✅ 分析完成\n');
      return parsed.topics || parsed;
    }
    
    // 尝试直接解析
    const parsed = JSON.parse(cleaned);
    console.log('   ✅ 分析完成\n');
    return parsed.topics || parsed;
    
  } catch (e) {
    console.error('   ⚠️ 分析失败:', e.message);
    // 返回默认结果
    return hotspots.slice(0, 2).map((h, i) => ({
      rank: i + 1,
      title: h.title,
      source: h.platform,
      angle: '深度分析',
      articleType: 'opinion',
      targetAudience: '对话题感兴趣的读者',
      sellingPoint: h.title,
      why: '热度较高'
    }));
  }
}

// 保存分析结果
function saveAnalysis(topics, dateStr) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output');
  const filePath = path.join(outputDir, `${today}-topics.json`);
  
  fs.writeFileSync(filePath, JSON.stringify({
    date: today,
    timestamp: new Date().toISOString(),
    count: topics.length,
    topics: topics
  }, null, 2));
  
  console.log(`💾 分析结果已保存: ${filePath}\n`);
  return filePath;
}

// 主函数
async function main(dateStr) {
  const hotspots = loadHotspots(dateStr);
  console.log(`📊 加载了 ${hotspots.length} 条热点`);
  
  const topics = await analyzeTopics(hotspots);
  saveAnalysis(topics, dateStr);
  
  console.log('📌 选出的写作话题：\n');
  topics.forEach(t => {
    console.log(`  ${t.rank}. ${t.title}`);
    console.log(`     类型: ${t.articleType} | 角度: ${t.angle}`);
    console.log(`     卖点: ${t.sellingPoint}`);
    console.log(`     理由: ${t.why}\n`);
  });
  
  return topics;
}

// CLI
if (require.main === module) {
  const dateStr = process.argv[2];
  main(dateStr)
    .then(() => {
      console.log('✅ 话题分析完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 话题分析失败:', err);
      process.exit(1);
    });
}

module.exports = { main, analyzeTopics, loadHotspots };
