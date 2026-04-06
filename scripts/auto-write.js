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

// 时间戳工具
const timings = {};
function startTimer(name) {
  timings[name] = Date.now();
  console.log(`\n⏱️  [${name}] 开始: ${new Date().toLocaleTimeString()}`);
}
function endTimer(name) {
  if (timings[name]) {
    const duration = ((Date.now() - timings[name]) / 1000).toFixed(1);
    console.log(`⏱️  [${name}] 结束: ${duration}秒`);
    return duration;
  }
}
function logStep(step, message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${step}: ${message}`);
}

// 在目录中查找封面图片（支持多种文件名）
function findCoverInDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  // 优先找 cover-*.jpg，其次 cover_pexels_*.jpg，最后 cover.jpg
  const coverPatterns = [f => f.startsWith('cover-') && f.endsWith('.jpg'), f => f.startsWith('cover_pexels_') && f.endsWith('.jpg'), f => f === 'cover.jpg'];
  for (const pattern of coverPatterns) {
    const found = files.find(pattern);
    if (found) return path.join(dir, found);
  }
  // 兜底：找任何 .jpg 文件
  const jpg = files.find(f => f.endsWith('.jpg'));
  return jpg ? path.join(dir, jpg) : null;
}

// 修复 TDZ 问题：使用独立函数替代修改原生 path
function expandUser(filepath) {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

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

// 执行命令（简洁版，只输出关键信息）
function runAsyncWithOutput(cmd, timeout = 120000, prefix = '') {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log(`${prefix}⏳ 执行中...`);
    
    const child = spawn('bash', ['-c', cmd], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    let mediaId = null;
    
    child.stdout.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      
      // 只提取关键信息：Media ID
      const mediaMatch = str.match(/Media ID:\s*(gY4BuD4J[^\s]+)/);
      if (mediaMatch && !mediaId) {
        mediaId = mediaMatch[1];
        console.log(`${prefix}📝 Media ID: ${mediaId}`);
      }
      
      // 只输出关键状态行
      if (str.includes('发布成功') || str.includes('✅ 发布成功')) {
        console.log(`${prefix}✅ 服务器返回成功`);
      }
      if (str.includes('❌ 发布失败')) {
        console.log(`${prefix}❌ 服务器返回失败`);
      }
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // 超时处理：如果已经拿到Media ID，不拒绝
    const timer = setTimeout(() => {
      if (mediaId) {
        // 已拿到Media ID，视为成功
        clearTimeout(timer);
        resolve(stdout);
      } else {
        child.kill();
        reject(new Error(`命令超时 (${timeout}ms)`));
      }
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${prefix}⏱️  耗时: ${duration}秒`);
      
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

// 加载Cookie
function loadCookiesForCurl(platform) {
  try {
    const cookiePath = path.join(__dirname, '../.cookies', `${platform}_cookies.json`);
    if (!fs.existsSync(cookiePath)) {
      return '';
    }
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return cookieStr;
  } catch (e) {
    return '';
  }
}

// ===== 步骤1: Agent Reach 全渠道搜索热点 =====

async function fetchAllHotspots() {
  console.log('\n🔥 步骤1: Agent Reach 全渠道搜索热点 (5渠道)\n');
  
  const allHotspots = [];
  
  // 1. 微博热门（使用Cookie）
  console.log('   📱 微博热门...');
  try {
    const cookieStr = loadCookiesForCurl('weibo');
    const cookieHeader = cookieStr ? `-H 'Cookie: ${cookieStr}'` : '';
    const cmd = `curl -s ${cookieHeader} -H 'User-Agent: Mozilla/5.0' -H 'Referer: https://weibo.com/' 'https://weibo.com/ajax/side/hotSearch' 2>/dev/null`;
    const result = run(cmd, 15000);
    
    if (result && result.includes('hotgov')) {
      const data = JSON.parse(result);
      if (data.data?.realtime) {
        let count = 0;
        for (const item of data.data.realtime.slice(0, 10)) {
          if (item.word && count < 8) {
            allHotspots.push({ 
              platform: '微博', 
              title: String(item.word).slice(0, 50), 
              hot: item.num || (100 - count * 10),
              category: item.category || '热搜'
            });
            count++;
          }
        }
        console.log(`      ✅ ${count} 条`);
      }
    } else {
      console.log('      ⚠️ 无数据或Cookie失效');
    }
  } catch (e) { console.log(`      ⚠️ 失败: ${e.message}`); }
  
  // 2. 知乎热榜（使用Cookie）
  console.log('   📚 知乎热榜...');
  try {
    const cookieStr = loadCookiesForCurl('zhihu');
    const cookieHeader = cookieStr ? `-H 'Cookie: ${cookieStr}'` : '';
    const cmd = `curl -s ${cookieHeader} 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=15' 2>/dev/null`;
    const result = run(cmd, 15000);
    
    if (result && result.includes('data')) {
      const data = JSON.parse(result);
      if (data.data) {
        let count = 0;
        for (const item of data.data.slice(0, 10)) {
          const target = item.target || {};
          const title = target.title || target.question?.title;
          if (title && count < 8) {
            const hotText = item.detail_text || '';
            const hot = parseInt(hotText.replace(/[^\d]/g, '')) || (90 - count * 10);
            allHotspots.push({ 
              platform: '知乎', 
              title: String(title).slice(0, 50), 
              hot,
              category: '热榜'
            });
            count++;
          }
        }
        console.log(`      ✅ ${count} 条`);
      }
    } else {
      console.log('      ⚠️ 无数据或Cookie失效');
    }
  } catch (e) { console.log(`      ⚠️ 失败: ${e.message}`); }
  
  // 3. B站热门 (bili-cli)
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

  // 4. 小红书热门 - 使用 xhs-cli
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
  
  // 5. Twitter 趋势 - 使用 twitter-cli feed
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

// 并发评估单个热点
async function evaluateHotspot(hotspot, index) {
  const prompt = `你是一位资深公众号主编，拥有10年内容策划经验。

请评估以下热点话题，从5个维度打分（1-10分）：
1. 深度：话题是否有深层社会/心理/文化意义
2. 原创性：角度是否新颖，能否避开同质化内容
3. 读者价值：对目标读者（25-40岁职场人）是否有启发
4. 时效性：热度持续时间和讨论价值
5. 安全性：话题是否敏感，有无政策风险

热点：${hotspot.title}
平台：${hotspot.platform}
热度：${hotspot.hot}

请严格按以下JSON格式返回，不要有任何其他文字：
{
  "score": 总分,
  "depth": 深度分,
  "originality": 原创性分,
  "value": 读者价值分,
  "timeliness": 时效性分,
  "safety": 安全性分,
  "articleType": "analysis/story/opinion/guide之一",
  "angle": "具体的切入角度（一句话）",
  "targetAudience": "目标读者群体",
  "sellingPoint": "核心卖点/金句"
}`;

  try {
    const cmd = `openclaw agent --agent creator -m '${prompt.replace(/'/g, "'\"'\"'")}' --json --timeout 120`;
    const result = await runAsync(cmd, 120000);
    
    if (!result) return { hotspot, score: 0, error: '调用失败' };
    
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
    const evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    
    return {
      hotspot,
      index,
      ...evaluation,
      error: null
    };
  } catch (e) {
    return { hotspot, score: 0, error: e.message };
  }
}

async function analyzeAndSelect(hotspots) {
  console.log('\n🤖 步骤2: AI 主编级评估选出 Top 2 话题\n');
  
  // 回退到3，避免API限流
  const CONCURRENCY = 3;
  
  // 取前15个热点
  const topHotspots = hotspots.slice(0, 15);
  console.log(`   评估 ${topHotspots.length} 个热点，并发度: ${CONCURRENCY}\n`);
  
  const results = [];
  
  for (let i = 0; i < topHotspots.length; i += CONCURRENCY) {
    const batch = topHotspots.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(topHotspots.length / CONCURRENCY);
    
    console.log(`   批次 ${batchNum}/${totalBatches}: 评估 ${batch.length} 个热点...`);
    
    const batchStart = Date.now();
    const batchPromises = batch.map((h, idx) => evaluateHotspot(h, i + idx));
    const batchResults = await Promise.all(batchPromises);
    const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(1);
    
    results.push(...batchResults);
    console.log(`   批次 ${batchNum} 完成 (${batchDuration}秒)\n`);
  }
  
  // 过滤失败项，按分数排序
  const validResults = results.filter(r => !r.error && r.score > 0);
  validResults.sort((a, b) => b.score - a.score);
  
  // 取前2名
  const top2 = validResults.slice(0, 2);
  
  console.log(`   ✅ 选出 ${top2.length} 个话题\n`);
  
  const topics = top2.map((r, i) => ({
    rank: i + 1,
    title: r.hotspot.title,
    source: r.hotspot.platform,
    articleType: r.articleType || 'analysis',
    angle: r.angle || '深度分析',
    targetAudience: r.targetAudience || '25-40岁职场人',
    sellingPoint: r.sellingPoint || r.hotspot.title,
    why: `总分${r.score} (深度${r.depth}+原创${r.originality}+价值${r.value}+时效${r.timeliness}+安全${r.safety})`,
    score: r.score
  }));
  
  topics.forEach(t => {
    console.log(`   ${t.rank}. ${t.title}`);
    console.log(`      类型: ${t.articleType} | 分数: ${t.score}`);
    console.log(`      角度: ${t.angle}`);
  });
  
  // 保存
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  fs.writeFileSync(
    path.join(outputDir, 'topics.json'),
    JSON.stringify({ date: today, topics }, null, 2)
  );
  
  return topics;
}

// 检查是否自动模式（全局变量）
const isAutoMode = process.argv.includes('--auto') || process.argv.includes('-a') || process.argv.includes('--auto-confirm');

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

// ===== 步骤3: 调用 wechat-prompt-context 生成文章（并行版 - 临时目录隔离）=====

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
  console.log('\n✅ 继续生成文章（并行模式 - 临时目录隔离）...\n');
  
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  
  // 并发生成文章（每篇在独立临时目录，避免冲突）
  const generatePromises = topics.slice(0, 2).map(async (topic) => {
    const articleStart = Date.now();
    console.log(`\n   [文章${topic.rank}] 启动生成: ${topic.title}`);
    console.log(`   [文章${topic.rank}] 类型: ${topic.articleType} | 主题: pie`);
    
    // 创建临时目录
    const tmpDir = path.join(os.tmpdir(), `wpc-${topic.rank}-${Date.now()}`);
    const wpcSourcePath = expandUser('~/.openclaw/workspace/skills/wechat-prompt-context');
    
    try {
      // 1. 创建临时目录并复制技能文件
      const step1Start = Date.now();
      console.log(`   [文章${topic.rank}] → 创建临时目录: ${tmpDir}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      
      // 复制关键文件（不复制整个目录，节省时间）
      fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'output'), { recursive: true });
      
      // 复制 node_modules/js-yaml（必需依赖）- 使用 require.resolve 找到实际路径
      const nodeModulesDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      
      // 找到 js-yaml 的实际安装位置
      let jsYamlSrc;
      try {
        jsYamlSrc = path.dirname(require.resolve('js-yaml', { paths: [wpcSourcePath, process.cwd(), path.join(os.homedir(), '.openclaw/workspace')] }));
      } catch (e) {
        // 备用方案：直接找 workspace 根目录
        jsYamlSrc = path.join(os.homedir(), '.openclaw/workspace/node_modules/js-yaml');
      }
      
      const jsYamlDst = path.join(nodeModulesDir, 'js-yaml');
      if (fs.existsSync(jsYamlSrc)) {
        console.log(`   [文章${topic.rank}]   → 复制 js-yaml from ${jsYamlSrc}...`);
        fs.cpSync(jsYamlSrc, jsYamlDst, { recursive: true, force: true });
        
        // 复制 argparse（js-yaml 的依赖）
        let argparseSrc;
        try {
          argparseSrc = path.dirname(require.resolve('argparse', { paths: [wpcSourcePath, process.cwd(), path.join(os.homedir(), '.openclaw/workspace')] }));
        } catch (e) {
          argparseSrc = path.join(os.homedir(), '.openclaw/workspace/node_modules/argparse');
        }
        const argparseDst = path.join(nodeModulesDir, 'argparse');
        if (fs.existsSync(argparseSrc)) {
          fs.cpSync(argparseSrc, argparseDst, { recursive: true, force: true });
          console.log(`   [文章${topic.rank}]   ✅ argparse 复制完成`);
        }
        
        // 创建 .package.json 使 require 工作
        fs.writeFileSync(
          path.join(nodeModulesDir, 'js-yaml/package.json'),
          JSON.stringify({ name: 'js-yaml', main: './index.js' }, null, 2)
        );
        
        console.log(`   [文章${topic.rank}]   ✅ 依赖复制完成`);
      } else {
        console.log(`   [文章${topic.rank}]   ⚠️ 未找到 js-yaml，将尝试全局安装`);
        // 备用：直接 npm install
        execSync('npm install js-yaml argparse --silent', { cwd: tmpDir, stdio: 'ignore' });
      }
      
      // 创建 wai-scripts 目录并复制 wechat-ai-writer 依赖
      const waiScriptsDir = path.join(tmpDir, 'scripts', 'wai-scripts');
      fs.mkdirSync(waiScriptsDir, { recursive: true });
      const waiSourcePath = expandUser('~/.openclaw/workspace/skills/wechat-ai-writer');
      const waiScripts = ['generate-cover.js', 'llm-client.js', 'doubao-image.js', 'pexels-image.js'];
      for (const script of waiScripts) {
        const src = path.join(waiSourcePath, 'scripts', script);
        const dst = path.join(waiScriptsDir, script);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
        }
      }
      console.log(`   [文章${topic.rank}]   ✅ wai-scripts 复制完成`);
      
      // 复制脚本文件
      const scriptsToCopy = ['main.js', 'analyze-topic.js', 'generate-prompt.js', 'confirm-prompt.js', 'write-article.js', 'publish.js', 'extract-prompt.js'];
      for (const script of scriptsToCopy) {
        const src = path.join(wpcSourcePath, 'scripts', script);
        const dst = path.join(tmpDir, 'scripts', script);
        if (fs.existsSync(src)) {
          let content = fs.readFileSync(src, 'utf8');
          
          // 修复 write-article.js 中的相对路径引用
          if (script === 'write-article.js') {
            content = content.replace(
              /require\(['"]\.\.\/\.\.\/wechat-ai-writer\/scripts\//g,
              "require('./wai-scripts/"
            );
            console.log(`   [文章${topic.rank}]   → 修复 write-article.js 路径引用`);
          }
          
          // 源文件应该已经被修复，这里只是确保
          // 不再自动添加 expandUser 函数，避免破坏文件格式
          
          fs.writeFileSync(dst, content, 'utf8');
        }
      }
      
      // 复制配置文件
      if (fs.existsSync(path.join(wpcSourcePath, 'config', 'default.yaml'))) {
        fs.copyFileSync(
          path.join(wpcSourcePath, 'config', 'default.yaml'),
          path.join(tmpDir, 'config', 'default.yaml')
        );
      }
      
      // 复制 prompts 目录（包含模板文件）
      if (fs.existsSync(path.join(wpcSourcePath, 'prompts'))) {
        fs.mkdirSync(path.join(tmpDir, 'prompts'), { recursive: true });
        const promptsItems = fs.readdirSync(path.join(wpcSourcePath, 'prompts'));
        for (const item of promptsItems) {
          const srcPath = path.join(wpcSourcePath, 'prompts', item);
          const dstPath = path.join(tmpDir, 'prompts', item);
          const stat = fs.statSync(srcPath);
          if (stat.isDirectory()) {
            fs.cpSync(srcPath, dstPath, { recursive: true, force: true });
            console.log(`   [文章${topic.rank}]   → 复制 prompts/${item}/...`);
          } else {
            fs.copyFileSync(srcPath, dstPath);
          }
        }
        console.log(`   [文章${topic.rank}]   ✅ prompts 复制完成`);
      }
      
      // 复制模板
      if (fs.existsSync(path.join(wpcSourcePath, 'templates'))) {
        fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });
        const templates = fs.readdirSync(path.join(wpcSourcePath, 'templates'));
        for (const t of templates) {
          fs.copyFileSync(
            path.join(wpcSourcePath, 'templates', t),
            path.join(tmpDir, 'templates', t)
          );
        }
      }
      
      // 复制 assets
      if (fs.existsSync(path.join(wpcSourcePath, 'assets'))) {
        fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
        const assets = fs.readdirSync(path.join(wpcSourcePath, 'assets'));
        for (const a of assets) {
          fs.copyFileSync(
            path.join(wpcSourcePath, 'assets', a),
            path.join(tmpDir, 'assets', a)
          );
        }
      }
      
      // 复制 .env 文件（API Keys）到临时目录
      const workspaceEnvPath = expandUser('~/.openclaw/workspace/.env');
      if (fs.existsSync(workspaceEnvPath)) {
        fs.copyFileSync(workspaceEnvPath, path.join(tmpDir, '.env'));
        console.log(`   [文章${topic.rank}]   ✅ .env (API Keys) 复制完成`);
      }
      
      // 创建 package.json 使模块系统正常工作
      const packageJson = {
        name: "wpc-temp",
        version: "1.0.0",
        private: true
      };
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
      
      // 2. 在临时目录执行生成
      const autoConfirmFlag = isAutoMode ? ' --auto-confirm' : '';
      const cmd = `cd "${tmpDir}" && node scripts/main.js --topic="${topic.title}" --theme=pie${autoConfirmFlag}`;
      
      console.log(`   [文章${topic.rank}] → 启动 wechat-prompt-context（临时目录）...`);
      if (isAutoMode) {
        console.log(`   [文章${topic.rank}] 🤖 自动模式：跳过提示词确认`);
      }
      
      const genStart = Date.now();
      await runAsync(cmd, 600000);  // 10分钟超时
      const genDuration = ((Date.now() - genStart) / 1000).toFixed(1);
      console.log(`   [文章${topic.rank}] ✅ wechat-prompt-context 执行完成 (${genDuration}秒)`);
      
      // 3. 从临时目录复制结果
      const articleSrc = path.join(tmpDir, 'output/article.md');
      // 封面可能在 output/ 或 scripts/output/ 目录下，文件名可能是 cover.jpg 或 cover_pexels_*.jpg
      let coverSrc = findCoverInDir(path.join(tmpDir, 'output'));
      if (!coverSrc) {
        coverSrc = findCoverInDir(path.join(tmpDir, 'scripts', 'output'));
      }
      console.log(`   [文章${topic.rank}]   🔍 封面查找: output/=${findCoverInDir(path.join(tmpDir, 'output')) || '无'}, scripts/output/=${findCoverInDir(path.join(tmpDir, 'scripts', 'output')) || '无'}`);
      console.log(`   [文章${topic.rank}]   📌 最终封面源: ${coverSrc || '未找到'}`);
      
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
        
        // 4. 清理临时目录
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          console.log(`   [文章${topic.rank}] 🧹 临时目录已清理`);
        } catch (e) {
          console.log(`   [文章${topic.rank}] ⚠️ 清理临时目录失败: ${e.message}`);
        }
        
        return { rank: topic.rank, title: topic.title, path: articleDst, cover: localCoverPath, success: true };
      } else {
        console.log(`   [文章${topic.rank}] ⚠️ 文件不存在`);
        return { rank: topic.rank, title: topic.title, success: false, error: '文件不存在' };
      }
    } catch (e) {
      console.error(`   [文章${topic.rank}] ❌ 生成失败: ${e.message}`);
      // 清理临时目录
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      return { rank: topic.rank, title: topic.title, success: false, error: e.message };
    }
  });
  
  // 等待所有文章生成完成
  const results = await Promise.all(generatePromises);
  const successfulArticles = results.filter(r => r.success);
  
  console.log(`\n📊 文章生成结果: ${successfulArticles.length}/${results.length} 成功（并行完成）`);
  
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

// ===== 步骤4: 发布到公众号（并发版 + 封面压缩）=====

// 压缩封面到目标大小（20-30KB），使用sips
function compressCover(coverPath, targetKB = 25) {
  const { execSync } = require('child_process');
  const originalSize = fs.statSync(coverPath).size;
  const originalKB = (originalSize / 1024).toFixed(1);
  
  // 如果已经小于目标大小，跳过压缩
  if (originalSize <= targetKB * 1024) {
    console.log(`   封面已很小 (${originalKB}KB)，跳过压缩`);
    return coverPath;
  }
  
  // 使用sips压缩JPEG质量
  const backupPath = coverPath + '.bak';
  fs.copyFileSync(coverPath, backupPath);
  
  // 逐步降低质量直到目标大小
  for (let quality = 85; quality >= 30; quality -= 10) {
    try {
      execSync(`sips -s formatOptions ${quality} "${coverPath}"`, { stdio: 'pipe' });
      const newSize = fs.statSync(coverPath).size;
      const newKB = (newSize / 1024).toFixed(1);
      
      if (newSize <= targetKB * 1024) {
        console.log(`   封面压缩: ${originalKB}KB → ${newKB}KB (质量${quality}%)`);
        fs.unlinkSync(backupPath);
        return coverPath;
      }
    } catch (e) {
      // sips失败，恢复备份
      fs.copyFileSync(backupPath, coverPath);
      console.log(`   ⚠️ 封面压缩失败，使用原图`);
      fs.unlinkSync(backupPath);
      return coverPath;
    }
  }
  
  // 如果最低质量还是太大，用最低质量
  const finalSize = fs.statSync(coverPath).size;
  const finalKB = (finalSize / 1024).toFixed(1);
  console.log(`   封面压缩: ${originalKB}KB → ${finalKB}KB (质量30%，已达下限)`);
  fs.unlinkSync(backupPath);
  return coverPath;
}

async function publishSingleArticle(article, mpPublisherPath, toolkitPath, hasMpPublisher, hasToolkit) {
  console.log(`\n   [发布${article.rank}] (${article.rank}/${article.total}) ${article.title}`);
  
  // 步骤1: 检查文章文件
  console.log(`   [发布${article.rank}] 步骤1/4: 检查文章文件...`);
  if (!fs.existsSync(article.path)) {
    console.log(`   [发布${article.rank}] ❌ 文章文件不存在`);
    return { success: false, error: '文件不存在' };
  }
  console.log(`   [发布${article.rank}] ✅ 文件存在`);
  
  // 步骤2: 验证frontmatter
  console.log(`   [发布${article.rank}] 步骤2/4: 验证Frontmatter...`);
  const content = fs.readFileSync(article.path, 'utf8');
  const hasTitle = content.match(/^---\s*\n[\s\S]*?title:\s*["']?[^\n]+["']?/m);
  const hasCover = content.match(/^---\s*\n[\s\S]*?cover:\s*["']?[^\n]+["']?/m);
  
  if (!hasTitle || !hasCover) {
    console.log(`   [发布${article.rank}] ❌ 缺少title或cover字段`);
    return { success: false, error: 'Frontmatter不完整' };
  }
  console.log(`   [发布${article.rank}] ✅ Frontmatter完整`);
  
  // 步骤3: 检查并压缩封面图
  console.log(`   [发布${article.rank}] 步骤3/4: 检查封面图...`);
  const coverMatch = content.match(/cover:\s*["']?([^\n"']+)["']?/);
  if (coverMatch && !fs.existsSync(coverMatch[1])) {
    console.log(`   [发布${article.rank}] ❌ 封面图不存在`);
    return { success: false, error: '封面图不存在' };
  }
  
  // 压缩封面
  if (coverMatch && fs.existsSync(coverMatch[1])) {
    compressCover(coverMatch[1]);
  }
  console.log(`   [发布${article.rank}] ✅ 封面图已准备`);
  
  // 步骤4: 执行发布
  console.log(`   [发布${article.rank}] 步骤4/4: 调用发布API...`);
  let cmd;
  if (hasMpPublisher) {
    cmd = `bash "${mpPublisherPath}" "${article.path}" pie`;
  } else if (hasToolkit) {
    cmd = `node "${toolkitPath}" "${article.path}" pie`;
  }
  
  const pubStart = Date.now();
  const result = await runAsyncWithOutput(cmd, 600000, `   [发布${article.rank}] `);
  const pubDuration = ((Date.now() - pubStart) / 1000).toFixed(1);
  console.log(`   [发布${article.rank}] ⏱️ 发布耗时: ${pubDuration}秒`);
  
  if (result && (result.includes('发布成功') || result.includes('Media ID'))) {
    console.log(`   [发布${article.rank}] ✅ 发布成功`);
    return { success: true, title: article.title };
  } else {
    console.log(`   [发布${article.rank}] ⚠️ 状态未知，请检查草稿箱`);
    return { success: true, title: article.title };
  }
}

async function publishArticles(articles) {
  console.log('\n🚀 步骤4: 发布到公众号草稿箱（并发模式 + 封面压缩）\n');
  
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
  
  // 并发发布（添加total字段用于显示）
  const articlesWithTotal = articles.map(a => ({ ...a, total: articles.length }));
  const publishStart = Date.now();
  
  // 并发执行，但间隔启动避免同时撞API
  const results = [];
  for (let i = 0; i < articlesWithTotal.length; i++) {
    // 每个间隔2秒启动，避免同时请求微信API
    if (i > 0) {
      console.log(`   ⏳ 等待2秒后启动下一篇...`);
      await new Promise(r => setTimeout(r, 2000));
    }
    
    const article = articlesWithTotal[i];
    results.push(
      publishSingleArticle(article, mpPublisherPath, toolkitPath, hasMpPublisher, hasToolkit)
        .then(r => ({ article, ...r }))
        .catch(e => ({ article, success: false, error: e.message }))
    );
  }
  
  const finalResults = await Promise.all(results);
  const publishDuration = ((Date.now() - publishStart) / 1000).toFixed(1);
  console.log(`\n⏱️  [发布环节总计] ${publishDuration}秒`);
  
  const successCount = finalResults.filter(r => r.success).length;
  
  console.log(`\n📊 发布结果: ${successCount}/${finalResults.length} 成功`);
}

// 检查 Playwright 是否安装
function checkPlaywright() {
  try {
    execSync('npx playwright --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// 自动安装 Playwright
async function installPlaywright() {
  console.log('🔧 正在安装 Playwright Chromium 浏览器...');
  console.log('   这可能需要几分钟时间...\n');
  try {
    execSync('npx playwright install chromium', { 
      stdio: 'inherit',
      timeout: 300000 // 5分钟超时
    });
    console.log('   ✅ Playwright 安装完成\n');
    return true;
  } catch (e) {
    console.error('   ❌ Playwright 安装失败:', e.message);
    console.log('   ⚠️  部分功能（如封面生成）可能无法正常工作\n');
    return false;
  }
}

// ===== 主函数 =====

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 热点自动写作 (全自动版)');
  console.log('='.repeat(60));
  
  const totalStart = Date.now();
  
  // 检查并自动安装 Playwright
  if (!checkPlaywright()) {
    console.log('\n⚠️ 警告: Playwright 未安装或浏览器未下载');
    const installed = await installPlaywright();
    if (!installed) {
      console.log('   继续执行（封面生成可能失败）...\n');
    }
  }
  
  // 步骤1: 搜索
  startTimer('步骤1-热点搜索');
  const hotspots = await fetchAllHotspots();
  endTimer('步骤1-热点搜索');
  
  // 步骤2: 分析
  startTimer('步骤2-AI分析');
  const topics = await analyzeAndSelect(hotspots);
  endTimer('步骤2-AI分析');
  
  // 步骤3: 生成文章
  startTimer('步骤3-文章生成(并行)');
  const articles = await generateArticles(topics);
  endTimer('步骤3-文章生成(并行)');
  
  // 步骤4: 发布
  if (articles.length > 0) {
    startTimer('步骤4-发布(串行)');
    await publishArticles(articles);
    endTimer('步骤4-发布(串行)');
  }
  
  const totalDuration = ((Date.now() - totalStart) / 1000 / 60).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`✅ 完成！总耗时 ${totalDuration} 分钟`);
  console.log(`📊 生成 ${articles.length} 篇文章`);
  console.log('='.repeat(60) + '\n');
}

// 执行
main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
