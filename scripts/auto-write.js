#!/usr/bin/env node
/**
 * 全自动热点写作 - 直接使用 wechat-prompt-context 生成并发布文章
 * 流程: Agent Reach 全渠道搜索 → AI筛选话题 → 调用 wechat-prompt-context → 生成并发布
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

// 加载配置文件
const config = require('../config/prompts.js');

// 扩展 path
path.expanduser = function(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
};

// 执行命令（同步版本）
function run(cmd, timeout = 60000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      }
    });
  } catch (e) {
    console.error(`   ⚠️ 命令失败: ${cmd}`);
    console.error(`      ${e.message}`);
    return null;
  }
}

// 执行命令（异步版本，用于并行）
function runAsync(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', cmd], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      }
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // 超时处理
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`命令超时 (${timeout}ms)`));
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `退出码 ${code}`));
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ===== 步骤1: Agent Reach 全渠道搜索热点 =====

async function fetchAllHotspots() {
  console.log('\n🔥 步骤1: Agent Reach 全渠道搜索热点\n');
  
  const allHotspots = [];
  
  // 1. B站热门 (bili-cli)
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

  // 2. 小红书热门 - 使用 xhs-cli
  console.log('   📕 小红书热门...');
  try {
    const result = run('xhs hot 2>/dev/null || xhs feed 2>/dev/null', 30000);
    if (result) {
      // 尝试解析 YAML 格式
      const lines = result.split('\n');
      let inItems = false;
      let currentItem = {};
      let count = 0;
      
      for (const line of lines) {
        if (line.includes('items:')) inItems = true;
        if (inItems && line.trim().startsWith('- id:')) {
          if (currentItem.title && count < 8) {
            allHotspots.push({
              platform: '小红书',
              title: currentItem.title.slice(0, 50),
              hot: currentItem.likes || 80 - count * 5,
              category: '热门笔记'
            });
            count++;
          }
          currentItem = {};
        }
        if (inItems && line.includes('title:')) {
          const match = line.match(/title:\s*(.+)/);
          if (match) currentItem.title = match[1].trim().replace(/^['"]|['"]$/g, '');
        }
        if (inItems && line.includes('likes:')) {
          const match = line.match(/likes:\s*(\d+)/);
          if (match) currentItem.likes = parseInt(match[1]);
        }
      }
      if (currentItem.title && count < 8) {
        allHotspots.push({
          platform: '小红书',
          title: currentItem.title.slice(0, 50),
          hot: currentItem.likes || 50,
          category: '热门笔记'
        });
        count++;
      }
      console.log(`      ✅ ${count} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  // 3. Twitter 趋势 - 使用 twitter-cli feed
  console.log('   🐦 Twitter 趋势...');
  try {
    const result = run('twitter feed -n 10 2>/dev/null', 30000);
    if (result) {
      // 解析 YAML 格式
      const lines = result.split('\n');
      let inTweet = false;
      let currentText = '';
      let count = 0;
      
      for (const line of lines) {
        if (line.trim().startsWith('- id:')) {
          if (currentText && count < 8) {
            allHotspots.push({
              platform: 'Twitter',
              title: currentText.slice(0, 60),
              hot: 85 - count * 5,
              category: 'Trending'
            });
            count++;
          }
          currentText = '';
          inTweet = true;
        }
        if (inTweet && line.includes('text:')) {
          const match = line.match(/text:\s*(.+)/);
          if (match) currentText = match[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
      if (currentText && count < 8) {
        allHotspots.push({
          platform: 'Twitter',
          title: currentText.slice(0, 60),
          hot: 85 - count * 5,
          category: 'Trending'
        });
        count++;
      }
      console.log(`      ✅ ${count} 条`);
    }
  } catch (e) { console.log('      ⚠️ 失败'); }
  
  console.log(`\n   📊 共收集 ${allHotspots.length} 条热点`);
  
  // 保存
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  fs.writeFileSync(
    path.join(outputDir, 'hotspots.json'),
    JSON.stringify({ date: today, count: allHotspots.length, hotspots: allHotspots }, null, 2)
  );
  
  return allHotspots;
}

// ===== 步骤2: AI 分析选出 Top 2 =====

async function analyzeAndSelect(hotspots) {
  console.log('\n🤖 步骤2: AI 主编级评估选出 Top 2 话题\n');
  
  // 使用配置文件中的提示词模板
  const promptTemplate = config.topicSelectionPrompt;
  
  // 填充热点数据
  const hotspotsText = hotspots.slice(0, 30).map((h, i) => 
    `${i + 1}. [${h.platform}] ${h.title} (热度: ${h.hot})`
  ).join('\n');
  
  const prompt = promptTemplate.replace('{{hotspots}}', hotspotsText);

  try {
    const cmd = `openclaw agent --agent creator -m '${prompt.replace(/'/g, "'\"'\"'")}' --json --timeout 300`;
    const result = run(cmd, 300000);
    
    if (!result) throw new Error('Agent 调用失败');
    
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
    
    // 保存
    const today = new Date().toISOString().split('T')[0];
    const outputDir = path.join(__dirname, '../output', today);
    fs.writeFileSync(
      path.join(outputDir, 'topics.json'),
      JSON.stringify({ date: today, topics }, null, 2)
    );
    
    return topics;
  } catch (e) {
    console.error('   ⚠️ AI 分析失败:', e.message);
    // 返回默认
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

// 检查是否自动模式
const isAutoMode = process.argv.includes('--auto') || process.argv.includes('-a');

// 交互式确认
function confirmWithUser(topics) {
  // 自动模式：直接返回 yes
  if (isAutoMode) {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 【自动模式】跳过确认，直接生成文章');
    console.log('='.repeat(60));
    console.log('\nAI已选出以下2个话题准备生成文章：\n');
    topics.forEach(t => {
      console.log(`${t.rank}. ${t.title}`);
      console.log(`   来源: ${t.source} | 类型: ${t.articleType}`);
      console.log(`   角度: ${t.angle}`);
      console.log(`   理由: ${t.why}\n`);
    });
    console.log('   → 自动确认: yes\n');
    return Promise.resolve('yes');
  }
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    console.log('\n' + '='.repeat(60));
    console.log('🛑 【用户确认环节】');
    console.log('='.repeat(60));
    console.log('\nAI已选出以下2个话题准备生成文章：\n');
    
    topics.forEach(t => {
      console.log(`${t.rank}. ${t.title}`);
      console.log(`   来源: ${t.source} | 类型: ${t.articleType}`);
      console.log(`   角度: ${t.angle}`);
      console.log(`   理由: ${t.why}\n`);
    });
    
    rl.question('请选择：\n  [yes/y] - 继续生成文章\n  [skip/s] - 跳过生成\n  [quit/q] - 退出\n\n你的选择: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ===== 步骤3: 调用 wechat-prompt-context 生成文章（并发版）=====

async function generateArticles(topics) {
  console.log('\n📝 步骤3: 调用 wechat-prompt-context 生成文章\n');
  
  // 用户确认
  const userChoice = await confirmWithUser(topics);
  
  if (userChoice === 'quit' || userChoice === 'q') {
    console.log('\n👋 已退出');
    process.exit(0);
  }
  
  if (userChoice === 'skip' || userChoice === 's') {
    console.log('\n⏭️ 已跳过文章生成');
    return [];
  }
  
  // 继续生成
  console.log('\n✅ 继续生成文章（并发模式）...\n');
  
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  
  // 并发生成两篇文章
  const generatePromises = topics.slice(0, 2).map(async (topic) => {
    console.log(`\n   [文章${topic.rank}] 启动生成: ${topic.title}`);
    console.log(`   [文章${topic.rank}] 类型: ${topic.articleType} | 主题: pie`);
    
    try {
      // 调用 wechat-prompt-context 的 main.js（自动确认模式）
      const wpcPath = path.expanduser('~/.openclaw/workspace/skills/wechat-prompt-context');
      
      // 全自动模式：使用 --auto-confirm 参数
      const isAutoMode = process.argv.includes('--auto') || process.argv.includes('-a');
      const autoConfirmFlag = isAutoMode ? ' --auto-confirm' : '';
      
      const cmd = `cd "${wpcPath}" && node scripts/main.js --topic="${topic.title}" --theme=pie${autoConfirmFlag}`;
      
      console.log('   → 启动 wechat-prompt-context...');
      if (isAutoMode) {
        console.log('   🤖 自动模式：跳过提示词确认，直接生成文章\n');
      } else {
        console.log('   ⚠️ 手动模式：请在提示词确认环节输入 "yes"\n');
      }
      
      // 执行 wechat-prompt-context 主流程（包含：分析→提示词→确认→生成→发布）
      run(cmd, 600000);  // 10分钟超时
      
      console.log(`   [文章${topic.rank}] ✅ wechat-prompt-context 执行完成`);
      
      // 复制结果到本技能输出目录
      const articleSrc = path.join(wpcPath, 'output/article.md');
      const coverSrc = path.join(wpcPath, 'output/cover.jpg');
      
      if (fs.existsSync(articleSrc)) {
        const articleDst = path.join(outputDir, `article-${topic.rank}.md`);
        const coverDst = path.join(outputDir, `cover-${topic.rank}.jpg`);
        
        // 复制封面图
        if (fs.existsSync(coverSrc)) {
          fs.copyFileSync(coverSrc, coverDst);
        }
        
        // 读取文章并更新cover路径为本地路径
        let articleContent = fs.readFileSync(articleSrc, 'utf8');
        const localCoverPath = coverDst;
        
        // 替换frontmatter中的cover路径
        articleContent = articleContent.replace(
          /cover:\s*["']?[^\n"']+["']?/,
          `cover: "${localCoverPath}"`
        );
        
        // 写入更新后的文章
        fs.writeFileSync(articleDst, articleContent, 'utf8');
        
        console.log(`   [文章${topic.rank}] ✅ 生成完成: ${articleDst}`);
        return { rank: topic.rank, title: topic.title, path: articleDst, cover: localCoverPath, success: true };
      } else {
        console.log(`   [文章${topic.rank}] ⚠️ 文件不存在`);
        return { rank: topic.rank, title: topic.title, success: false, error: '文件不存在' };
      }
    } catch (e) {
      console.error(`   [文章${topic.rank}] ❌ 生成失败: ${e.message}`);
      return { rank: topic.rank, title: topic.title, success: false, error: e.message };
    }
  });
  
  // 等待所有文章生成完成
  const results = await Promise.all(generatePromises);
  const successfulArticles = results.filter(r => r.success);
  
  console.log(`\n📊 文章生成结果: ${successfulArticles.length}/${results.length} 成功`);
  
  // 保存结果
  fs.writeFileSync(
    path.join(outputDir, 'articles.json'),
    JSON.stringify({ date: today, count: successfulArticles.length, articles: successfulArticles }, null, 2)
  );
  
  return successfulArticles;
}

// 生成提示词
function generatePrompt(topic, analysis) {
  return `<role>
你是一位资深${topic.articleType === 'story' ? '故事写作者' : topic.articleType === 'analysis' ? '商业分析师' : topic.articleType === 'opinion' ? '观点评论员' : '干货分享者'}，擅长撰写高质量微信公众号文章。
</role>

<task>
撰写一篇关于"${topic.title}"的微信公众号文章。
</task>

<context>
目标读者: ${topic.targetAudience}
文章类型: ${topic.articleType}
切入角度: ${topic.angle}
核心卖点: ${topic.sellingPoint}

文章要求：
1. 字数 2500-3000 字
2. 有深度、有观点、有金句
3. 开头吸引人，结尾有升华
4. 文章结构清晰，逻辑严密
5. 语言风格符合微信公众号调性
</context>

<structure>
<beginning>
- 用${topic.sellingPoint}引入
- 制造悬念或冲突
- 引出主题
</beginning>

<body>
${topic.articleType === 'analysis' ? '- 现象分析\n- 深度剖析\n- 数据支撑\n- 趋势判断' : 
  topic.articleType === 'story' ? '- 故事背景\n- 情节发展\n- 高潮转折\n- 结局升华' :
  topic.articleType === 'opinion' ? '- 观点陈述\n- 正面论证\n- 反面论证\n- 深度思考' :
  '- 问题引入\n- 方法介绍\n- 案例说明\n- 实操步骤'}
</body>

<ending>
- 总结升华
- 金句收尾
- 引导互动
</ending>
</structure>

<constraints>
- 字数: 2500-3000 字
- 格式: Markdown
- 必须包含至少3个加粗金句
- 语气: ${topic.articleType === 'opinion' ? '有态度、有洞察' : '真诚、有温度'}
- 避免: 空洞说教、陈词滥调
</constraints>

<output>
请直接输出完整的公众号文章，包含：
1. 文章标题（有吸引力）
2. 正文（2500-3000字）
3. 使用Markdown格式
4. 金句用**加粗**
</output>`;
}

// ===== 步骤4: 发布到公众号（并发版）=====

async function publishArticles(articles) {
  console.log('\n🚀 步骤4: 发布到公众号草稿箱（并发模式）\n');
  
  // 查找发布工具
  const mpPublisherPath = path.join(os.homedir(), '.openclaw/workspace/skills/wechat-mp-publisher/scripts/publish.sh');
  const toolkitPath = path.join(os.homedir(), '.openclaw/workspace/skills/wechat-toolkit/scripts/publisher/publish.js');
  
  const hasMpPublisher = fs.existsSync(mpPublisherPath);
  const hasToolkit = fs.existsSync(toolkitPath);
  
  if (hasMpPublisher) {
    console.log('   使用 wechat-mp-publisher 发布（已修复）');
  } else if (hasToolkit) {
    console.log('   使用 wechat-toolkit 发布');
  } else {
    console.log('   未找到发布工具，跳过发布步骤');
    return;
  }
  
  // 并发发布所有文章
  const publishPromises = articles.map(async (article) => {
    console.log(`\n   [发布] 开始: ${article.title}`);
    
    try {
      // 先检查文章文件
      if (!fs.existsSync(article.path)) {
        console.log(`   [发布] ⚠️ 文章文件不存在: ${article.path}`);
        return { success: false, error: '文件不存在' };
      }
      
      // 读取并验证frontmatter
      const content = fs.readFileSync(article.path, 'utf8');
      const hasTitle = content.match(/^---\s*\n[\s\S]*?title:\s*["']?[^\n]+["']?/m);
      const hasCover = content.match(/^---\s*\n[\s\S]*?cover:\s*["']?[^\n]+["']?/m);
      
      if (!hasTitle) {
        console.log(`   [发布] ⚠️ 文章缺少title字段`);
        return { success: false, error: '缺少title字段' };
      }
      if (!hasCover) {
        console.log(`   [发布] ⚠️ 文章缺少cover字段`);
        return { success: false, error: '缺少cover字段' };
      }
      
      console.log(`   [发布] ✅ Frontmatter验证通过`);
      
      // 检查封面图是否存在
      const coverMatch = content.match(/cover:\s*["']?([^\n"']+)["']?/);
      if (coverMatch && !fs.existsSync(coverMatch[1])) {
        console.log(`   [发布] ⚠️ 封面图不存在: ${coverMatch[1]}`);
        return { success: false, error: '封面图不存在' };
      }
      
      let cmd;
      
      // 优先使用 wechat-mp-publisher（已修复-f参数）
      if (hasMpPublisher) {
        cmd = `bash "${mpPublisherPath}" "${article.path}" pie`;
        console.log(`   [发布] → 使用 wechat-mp-publisher...`);
      } else if (hasToolkit) {
        cmd = `node "${toolkitPath}" "${article.path}" pie`;
        console.log(`   [发布] → 使用 wechat-toolkit...`);
      }
      
      const result = await runAsync(cmd, 120000);
      
      if (result && (result.includes('发布成功') || result.includes('Media ID') || result.includes('草稿箱'))) {
        console.log(`   [发布] ✅ 成功: ${article.title}`);
        return { success: true, title: article.title };
      } else if (result && (result.includes('失败') || result.includes('错误'))) {
        console.log(`   [发布] ⚠️ 失败: ${result.split('\n')[0]}`);
        return { success: false, error: result.split('\n')[0] };
      } else {
        console.log(`   [发布] ✅ 完成: ${article.title}`);
        return { success: true, title: article.title };
      }
    } catch (e) {
      console.error(`   [发布] ❌ 失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });
  
  // 等待所有发布完成
  const results = await Promise.all(publishPromises);
  const successCount = results.filter(r => r.success).length;
  
  console.log(`\n📊 发布结果: ${successCount}/${results.length} 成功`);
}

// ===== 主函数 =====

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 热点自动写作 (全自动版)');
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  // 步骤1: 搜索
  const hotspots = await fetchAllHotspots();
  
  // 步骤2: 分析
  const topics = await analyzeAndSelect(hotspots);
  
  // 步骤3: 生成文章
  const articles = await generateArticles(topics);
  
  // 步骤4: 发布
  if (articles.length > 0) {
    await publishArticles(articles);
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`✅ 完成！耗时 ${duration} 分钟`);
  console.log(`📊 生成 ${articles.length} 篇文章`);
  console.log('='.repeat(60) + '\n');
}

// 执行
main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
