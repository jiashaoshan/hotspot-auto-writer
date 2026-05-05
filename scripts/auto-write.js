#!/usr/bin/env node
/**
 * 全自动热点写作 - 直接使用 wechat-prompt-context 生成并发布文章
 * 流程: Agent Reach 全渠道搜索 → AI筛选话题 → 调用 wechat-prompt-context → 生成并发布
 */

// 强制 stdout 无缓冲，确保实时输出到飞书
process.stdout._handle && process.stdout._handle.setBlocking && process.stdout._handle.setBlocking(true);

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// ===== 进度通知工具 =====
function sendProgress(message) {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `📢 [${timestamp}] ${message}`;
  console.log(`\n${fullMessage}\n`);
  
  // 强制刷新 stdout 缓冲区
  if (process.stdout && process.stdout.write) {
    process.stdout.write('');
  }
}

// 使用 OpenClaw message 工具直接发送飞书消息（更可靠）
function notifyFeishu(message) {
  try {
    // 尝试通过 OpenClaw CLI 发送消息到当前会话
    const { exec } = require('child_process');
    const chatId = process.env.OPENCLAW_CHAT_ID || process.env.FEISHU_CHAT_ID;
    
    if (chatId) {
      exec(`openclaw message send --channel feishu --target "${chatId}" --message "${message.replace(/"/g, '\\"')}"`, 
        { timeout: 5000 },
        (err) => {
          if (err) {
            // 静默失败，不影响主流程
            console.log(`[notify] ${message}`);
          }
        }
      );
    } else {
      console.log(`[notify] ${message}`);
    }
  } catch (e) {
    console.log(`[notify] ${message}`);
  }
}

// 加载配置文件
const config = require('../config/prompts.js');

// ===== 发布幂等性保护 =====
const PUBLISH_HISTORY_FILE = path.join(os.homedir(), '.openclaw/workspace/.publish-history.json');
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30分钟去重窗口（因为文章生成耗时较长）

// 计算文章内容指纹（MD5）
function getContentFingerprint(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // 提取正文内容（去掉 frontmatter）
    const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : content;
    return crypto.createHash('md5').update(body).digest('hex');
  } catch (e) {
    return null;
  }
}

// 加载发布历史
function loadPublishHistory() {
  try {
    if (fs.existsSync(PUBLISH_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(PUBLISH_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    return {};
  }
  return {};
}

// 保存发布历史
function savePublishHistory(history) {
  try {
    fs.writeFileSync(PUBLISH_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {}
}

// 检查是否最近已发布
function isRecentlyPublishedByContent(filePath) {
  const fingerprint = getContentFingerprint(filePath);
  if (!fingerprint) return false;
  
  const history = loadPublishHistory();
  const lastPublish = history[fingerprint];
  
  if (lastPublish) {
    const elapsed = Date.now() - lastPublish.timestamp;
    if (elapsed < DEDUP_WINDOW_MS) {
      const remainingMin = Math.ceil((DEDUP_WINDOW_MS - elapsed) / 60000);
      console.log(`      ⚠️ 相同内容 ${Math.floor(elapsed/60000)} 分钟前已发布过`);
      console.log(`      ⏳ 去重窗口剩余 ${remainingMin} 分钟，跳过发布`);
      return true;
    }
  }
  
  return false;
}

// 记录发布成功（按内容指纹）
function recordPublishByContent(filePath) {
  const fingerprint = getContentFingerprint(filePath);
  if (!fingerprint) return;
  
  const history = loadPublishHistory();
  history[fingerprint] = {
    timestamp: Date.now(),
    path: filePath
  };
  
  // 清理超过2小时的记录
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const key in history) {
    if (history[key].timestamp < twoHoursAgo) {
      delete history[key];
    }
  }
  
  savePublishHistory(history);
}

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
// 修复：使用 inherit 避免缓冲阻塞，通过临时文件捕获输出
function runAsyncWithOutput(cmd, timeout = 120000, prefix = '') {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log(`${prefix}⏳ 执行中...`);
    
    // 创建临时文件捕获输出
    const tmpFile = path.join(os.tmpdir(), `pub-${Date.now()}.log`);
    const cmdWithLog = `${cmd} 2>&1 | tee "${tmpFile}"`;
    
    const child = spawn('bash', ['-c', cmdWithLog], {
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
      },
      // 修复关键：使用 inherit 让输出直接透传，避免缓冲阻塞
      stdio: ['ignore', 'inherit', 'inherit']
    });
    
    let mediaId = null;
    let checkInterval = null;
    
    // 定期检查临时文件获取 Media ID
    checkInterval = setInterval(() => {
      try {
        if (fs.existsSync(tmpFile)) {
          const content = fs.readFileSync(tmpFile, 'utf8');
          const mediaMatch = content.match(/Media ID:\s*(gY4BuD4J[^\s]+)/);
          if (mediaMatch && !mediaId) {
            mediaId = mediaMatch[1];
            console.log(`${prefix}📝 Media ID: ${mediaId}`);
          }
          if (content.includes('发布成功') || content.includes('✅ 发布成功')) {
            // 不重复输出
          }
        }
      } catch (e) {}
    }, 500);
    
    // 超时处理：30秒应该足够（正常4秒）
    const timer = setTimeout(() => {
      clearInterval(checkInterval);
      child.kill();
      // 尝试读取最终结果
      let finalOutput = '';
      try {
        if (fs.existsSync(tmpFile)) {
          finalOutput = fs.readFileSync(tmpFile, 'utf8');
          fs.unlinkSync(tmpFile);
        }
      } catch (e) {}
      
      if (mediaId || finalOutput.includes('发布成功')) {
        // 已确认成功，即使超时也返回
        resolve(finalOutput || stdout);
      } else {
        reject(new Error(`发布超时 (${timeout}ms)，未检测到成功标记`));
      }
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(checkInterval);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${prefix}⏱️  耗时: ${duration}秒`);
      
      // 读取最终结果
      let finalOutput = '';
      try {
        if (fs.existsSync(tmpFile)) {
          finalOutput = fs.readFileSync(tmpFile, 'utf8');
          fs.unlinkSync(tmpFile);
        }
      } catch (e) {}
      
      if (code === 0 || finalOutput.includes('发布成功') || mediaId) {
        resolve(finalOutput);
      } else {
        reject(new Error(`发布失败，退出码 ${code}`));
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(checkInterval);
      try { fs.unlinkSync(tmpFile); } catch (e) {}
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

  // 4. 小红书热门 - 使用 redbook
  console.log('   📕 小红书热门...');
  try {
    // 使用 redbook feed 获取热门内容（JSON格式）
    const redbookCmd = process.env.REDBOOK_PATH || '~/.npm-global/bin/redbook';
    const result = run(`${redbookCmd} feed --json 2>/dev/null`, 60000);
    if (result) {
      // 解析 JSON 格式
      let data;
      try {
        data = JSON.parse(result);
      } catch (e) {
        // 尝试从输出中提取 JSON 部分
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        }
      }
      
      if (data && data.items && Array.isArray(data.items)) {
        let count = 0;
        for (const item of data.items.slice(0, 10)) {
          if (item.note_card && item.note_card.display_title && count < 8) {
            const title = item.note_card.display_title;
            const likes = item.note_card.interact_info?.liked_count || '0';
            const hotNum = parseInt(likes.replace(/[^\d]/g, '')) || (80 - count * 5);
            allHotspots.push({
              platform: '小红书',
              title: String(title).slice(0, 50),
              hot: hotNum,
              category: '热门笔记'
            });
            count++;
          }
        }
        console.log(`      ✅ ${count} 条`);
      } else {
        console.log('      ⚠️ 无数据或格式异常');
      }
    } else {
      console.log('      ⚠️ redbook 命令执行失败');
    }
  } catch (e) { 
    console.log(`      ⚠️ 失败: ${e.message}`);
  }
  
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
const https = require('https');

// 直接调用API评估热点（避免openclaw agent被SIGKILL）
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
    // 使用百炼API直接调用（bailian-plus的key）
    const apiKey = process.env.BAILIAN_API_KEY || 'sk-7795ea7cafd74636834b271471022594';
    const body = JSON.stringify({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500
    });
    
    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 120000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
      req.write(body);
      req.end();
    });
    
    if (response.status !== 200) {
      throw new Error(`API错误: ${response.status} - ${response.data.slice(0, 200)}`);
    }
    
    const parsed = JSON.parse(response.data);
    const content = parsed.choices?.[0]?.message?.content || '';
    
    if (!content) throw new Error('API返回空内容');
    
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    
    return {
      hotspot,
      index,
      ...evaluation,
      error: null
    };
  } catch (e) {
    console.log(`      ⚠️ 评估失败: ${hotspot.title} - ${e.message}`);
    return { hotspot, score: 0, error: e.message };
  }
}

async function analyzeAndSelect(hotspots) {
  console.log('\n🤖 步骤2: AI 主编级评估选出 Top 2 话题\n');
  
  // 并发度5，充分利用并行能力
  const CONCURRENCY = 5;
  
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

// 使用子Agent生成单篇文章
async function generateArticleWithSubAgent(topic, outputDir) {
  console.log(`\n   [文章${topic.rank}] 启动子Agent生成: ${topic.title.slice(0, 30)}...`);
  
  const subagentPath = path.join(__dirname, 'generate-article-subagent.js');
  const startTime = Date.now();
  
  try {
    // 使用 exec 直接调用子Agent脚本（独立进程，资源隔离）
    const cmd = `node "${subagentPath}" --topic="${topic.title}" --type="${topic.articleType}" --rank="${topic.rank}" --output-dir="${outputDir}"`;
    
    execSync(cmd, {
      stdio: 'inherit',
      timeout: 900000, // 15分钟超时
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // 检查生成的文件
    const articlePath = path.join(outputDir, `article-${topic.rank}.md`);
    const coverPath = path.join(outputDir, `cover-${topic.rank}.jpg`);
    
    if (fs.existsSync(articlePath)) {
      const content = fs.readFileSync(articlePath, 'utf8');
      const wordCount = content.replace(/\s/g, '').length;
      
      console.log(`   [文章${topic.rank}] ✅ 子Agent生成完成 (${duration}秒)`);
      console.log(`   [文章${topic.rank}]   字数: ${wordCount}`);
      
      return {
        rank: topic.rank,
        title: topic.title,
        path: articlePath,
        cover: `cover-${topic.rank}.jpg`,
        success: true,
        wordCount
      };
    } else {
      throw new Error('未找到生成的文章文件');
    }
    
  } catch (e) {
    console.error(`   [文章${topic.rank}] ❌ 子Agent失败: ${e.message}`);
    return {
      rank: topic.rank,
      title: topic.title,
      success: false,
      error: e.message
    };
  }
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

// ===== 内存检测与并发控制 =====

function getSystemMemoryInfo() {
  const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
  const freeMemGB = os.freemem() / 1024 / 1024 / 1024;
  return {
    totalGB: Math.round(totalMemGB * 10) / 10,
    freeGB: Math.round(freeMemGB * 10) / 10,
    isLowMemory: totalMemGB < 12, // 12GB 以下视为低内存
    canParallel: totalMemGB >= 16 && freeMemGB >= 6 // 16GB+ 且空闲6GB+ 才允许并行
  };
}

function getMemoryLimitMB() {
  const memInfo = getSystemMemoryInfo();
  if (memInfo.totalGB >= 16) {
    return 1024; // 16GB+ → 1GB/进程
  } else if (memInfo.totalGB >= 12) {
    return 800; // 12GB → 800MB/进程
  } else {
    return 600; // 8GB → 600MB/进程（但会强制串行）
  }
}

// ===== 步骤3: 调用 wechat-prompt-context 生成文章（智能串并行）=====

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
  
  // 检测内存，决定串行还是并行
  const memInfo = getSystemMemoryInfo();
  console.log(`\n💾 系统内存检测: 总计 ${memInfo.totalGB}GB, 空闲 ${memInfo.freeGB}GB`);
  
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  
  let results = [];
  
  if (memInfo.canParallel) {
    // 内存充足，使用并行模式
    console.log('\n✅ 内存充足，启用并行生成（2篇同时）...\n');
    results = await generateArticlesParallel(topics.slice(0, 2), outputDir);
  } else {
    // 内存不足，使用串行模式
    console.log('\n⚠️ 内存有限（<16GB），降级为串行生成（1篇接1篇）...\n');
    console.log('   提示: 串行模式更稳定，总耗时约8-10分钟\n');
    results = await generateArticlesSerial(topics.slice(0, 2), outputDir);
  }
  
  // 等待所有工作进程完成
  const successfulArticles = results.filter(r => r.success);
  
  console.log(`\n📊 文章生成结果: ${successfulArticles.length}/${results.length} 成功`);
  results.forEach(r => {
    if (r.success) {
      console.log(`   ✅ [文章${r.rank}] ${r.wordCount}字 | ${r.duration}秒`);
    } else {
      console.log(`   ❌ [文章${r.rank}] ${r.error}`);
    }
  });
  
  // 保存结果
  fs.writeFileSync(
    path.join(outputDir, 'articles.json'),
    JSON.stringify({ date: today, count: successfulArticles.length, articles: successfulArticles }, null, 2)
  );
  
  return successfulArticles;
}

// 并行生成模式（内存充足时使用）
async function generateArticlesParallel(topics, outputDir) {
  const workerPath = path.join(__dirname, 'generate-article-worker.js');
  const memoryLimitMB = getMemoryLimitMB();
  const workers = [];
  
  console.log(`🚀 启动并行文章生成（内存限制: ${memoryLimitMB}MB/进程）...\n`);
  
  // 启动2个工作进程，带内存限制
  for (const topic of topics) {
    console.log(`   [文章${topic.rank}] 启动工作进程: ${topic.title.slice(0, 40)}...`);
    
    const worker = spawn('node', [
      `--max-old-space-size=${memoryLimitMB}`, // 内存限制
      workerPath,
      `--topic=${topic.title}`,
      `--type=${topic.articleType}`,
      `--rank=${topic.rank}`,
      `--output-dir=${outputDir}`
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    workers.push({
      topic,
      process: worker,
      output: '',
      error: ''
    });
  }
  
  // 收集所有工作进程结果
  return await Promise.all(workers.map(w => new Promise((resolve) => {
    w.process.stdout.on('data', (data) => {
      w.output += data.toString();
    });
    
    w.process.stderr.on('data', (data) => {
      w.error += data.toString();
    });
    
    w.process.on('close', (code) => {
      try {
        // 尝试解析最后的JSON输出
        const lines = w.output.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const result = JSON.parse(lastLine);
        resolve(result);
      } catch (e) {
        resolve({
          success: false,
          rank: w.topic.rank,
          topic: w.topic.title,
          error: w.error || `进程退出码: ${code}`
        });
      }
    });
    
    // 超时保护（10分钟）
    setTimeout(() => {
      if (w.process.exitCode === null) {
        console.error(`   [文章${w.topic.rank}] ⚠️ 超时，强制终止`);
        w.process.kill('SIGTERM');
      }
    }, 600000);
  })));
}

// 串行生成模式（内存不足时使用，更稳定）
async function generateArticlesSerial(topics, outputDir) {
  const workerPath = path.join(__dirname, 'generate-article-worker.js');
  const memoryLimitMB = getMemoryLimitMB();
  const results = [];
  
  console.log(`📝 启动串行文章生成（内存限制: ${memoryLimitMB}MB/进程）...\n`);
  
  for (const topic of topics) {
    console.log(`\n   [文章${topic.rank}] 开始生成: ${topic.title.slice(0, 40)}...`);
    const startTime = Date.now();
    
    const worker = spawn('node', [
      `--max-old-space-size=${memoryLimitMB}`, // 内存限制
      workerPath,
      `--topic=${topic.title}`,
      `--type=${topic.articleType}`,
      `--rank=${topic.rank}`,
      `--output-dir=${outputDir}`
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let output = '';
    let errorOutput = '';
    
    const result = await new Promise((resolve) => {
      worker.stdout.on('data', (data) => {
        output += data.toString();
        // 实时输出进度
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
          if (line.includes('✅') || line.includes('🎨') || line.includes('✍️')) {
            console.log(`      ${line}`);
          }
        });
      });
      
      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      worker.on('close', (code) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        try {
          const lines = output.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const parsed = JSON.parse(lastLine);
          parsed.duration = duration;
          resolve(parsed);
        } catch (e) {
          resolve({
            success: false,
            rank: topic.rank,
            topic: topic.title,
            error: errorOutput || `进程退出码: ${code}`,
            duration
          });
        }
      });
      
      // 超时保护（10分钟）
      setTimeout(() => {
        if (worker.exitCode === null) {
          console.error(`      ⚠️ 超时，强制终止`);
          worker.kill('SIGTERM');
        }
      }, 600000);
    });
    
    results.push(result);
    
    if (result.success) {
      console.log(`   ✅ [文章${topic.rank}] 完成 | ${result.wordCount}字 | ${result.duration}秒`);
    } else {
      console.log(`   ❌ [文章${topic.rank}] 失败: ${result.error}`);
    }
    
    // 每篇完成后强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }
  }
  
  return results;
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
  // 兼容 articlePath -> path
  if (!article.path && article.articlePath) {
    article.path = article.articlePath;
  }
  if (!article.cover && article.coverPath) {
    article.cover = article.coverPath;
  }
  
  console.log(`\n   [发布${article.rank}] (${article.rank}/${article.total}) ${article.title}`);
  
  // 步骤0: 幂等性检查（基于内容）
  console.log(`   [发布${article.rank}] 步骤0: 检查是否已发布...`);
  if (isRecentlyPublishedByContent(article.path)) {
    console.log(`   [发布${article.rank}] ⏭️ 跳过（相同内容已发布）`);
    return { success: true, skipped: true, title: article.title };
  }
  console.log(`   [发布${article.rank}] ✅ 未发布过，继续`);
  
  // 步骤1: 检查文章文件
  console.log(`   [发布${article.rank}] 步骤1/5: 检查文章文件...`);
  if (!fs.existsSync(article.path)) {
    console.log(`   [发布${article.rank}] ❌ 文章文件不存在`);
    return { success: false, error: '文件不存在' };
  }
  console.log(`   [发布${article.rank}] ✅ 文件存在`);
  
  // 步骤2: 验证frontmatter和内容完整性
  console.log(`   [发布${article.rank}] 步骤2/5: 验证Frontmatter...`);
  const content = fs.readFileSync(article.path, 'utf8');
  const hasTitle = content.match(/^---\s*\n[\s\S]*?title:\s*["']?[^\n]+["']?/m);
  const hasCover = content.match(/^---\s*\n[\s\S]*?cover:\s*["']?[^\n]+["']?/m);
  
  if (!hasTitle || !hasCover) {
    console.log(`   [发布${article.rank}] ❌ 缺少title或cover字段`);
    return { success: false, error: 'Frontmatter不完整' };
  }
  console.log(`   [发布${article.rank}] ✅ Frontmatter完整`);
  
  // 步骤2b: 检查内容完整性（字数检查）
  console.log(`   [发布${article.rank}] 步骤2b/5: 检查内容完整性...`);
  const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : content;
  const wordCount = body.replace(/\s/g, '').length;
  const minWordCount = 1500; // 最低1500字
  
  console.log(`   [发布${article.rank}]   字数: ${wordCount} (最低要求: ${minWordCount})`);
  
  if (wordCount < minWordCount) {
    console.log(`   [发布${article.rank}] ❌ 字数不足 (${wordCount} < ${minWordCount})，文章生成不完整`);
    return { success: false, error: `字数不足: ${wordCount} < ${minWordCount}` };
  }
  console.log(`   [发布${article.rank}] ✅ 字数达标`);
  
  // 步骤3: 检查并压缩封面图
  const coverMatch = content.match(/cover:\s*["']?([^\n"']+)["']?/);
  
  if (coverMatch) {
    let coverPath = coverMatch[1].trim();
    // 如果是相对路径，转换为绝对路径
    if (!path.isAbsolute(coverPath)) {
      coverPath = path.join(path.dirname(article.path), coverPath);
    }
    
    if (!fs.existsSync(coverPath)) {
      console.log(`   [发布${article.rank}] ❌ 封面图不存在: ${coverPath}`);
      return { success: false, error: '封面图不存在' };
    }
    compressCover(coverPath);
    console.log(`   [发布${article.rank}] ✅ 封面图已准备: ${coverPath}`);
  } else {
    console.log(`   [发布${article.rank}] ⚠️ 无cover字段`);
  }
  console.log(`   [发布${article.rank}] ✅ 封面图已准备`);
  
  // 步骤4: 执行发布
  console.log(`   [发布${article.rank}] 步骤4/5: 调用发布API...`);
  let cmd;
  if (hasMpPublisher) {
    cmd = `bash "${mpPublisherPath}" "${article.path}" pie`;
  } else if (hasToolkit) {
    cmd = `node "${toolkitPath}" "${article.path}" pie`;
  }
  
  const pubStart = Date.now();
  let result;
  let pubSuccess = false;
  let mediaId = null;
  
  try {
    result = await runAsyncWithOutput(cmd, 600000, `   [发布${article.rank}] `);
    pubSuccess = result && (result.includes('发布成功') || result.includes('Media ID'));
    const mediaMatch = result?.match(/Media ID:\s*(gY4BuD4J[^\s]+)/);
    mediaId = mediaMatch ? mediaMatch[1] : null;
  } catch (e) {
    // 超时或异常，检查是否是超时错误
    if (e.message.includes('超时') || e.message.includes('timeout')) {
      console.log(`   [发布${article.rank}] ⚠️ 发布超时，等待5秒后检查草稿箱...`);
      await new Promise(r => setTimeout(r, 5000));
      
      // 重新检查是否已发布（通过幂等性检查）
      if (isRecentlyPublishedByContent(article.path)) {
        console.log(`   [发布${article.rank}] ✅ 检测到已发布（去重命中）`);
        pubSuccess = true;
      } else {
        console.log(`   [发布${article.rank}] ⚠️ 超时且未检测到发布记录，可能失败`);
      }
    } else {
      console.log(`   [发布${article.rank}] ❌ 发布异常: ${e.message}`);
    }
  }
  
  const pubDuration = ((Date.now() - pubStart) / 1000).toFixed(1);
  console.log(`   [发布${article.rank}] ⏱️ 发布耗时: ${pubDuration}秒`);
  
  if (pubSuccess) {
    // 记录发布成功
    recordPublishByContent(article.path);
    console.log(`   [发布${article.rank}] ✅ 发布成功${mediaId ? ` (Media ID: ${mediaId})` : ''}`);
    return { success: true, title: article.title, mediaId };
  } else {
    console.log(`   [发布${article.rank}] ❌ 发布失败，请检查草稿箱`);
    return { success: false, error: '发布失败或超时' };
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
  let currentStep = '启动';
  
  // 发送启动通知
  sendProgress('🚀 热点自动写作任务启动！预计总耗时 10-12 分钟');
  
  // 启动心跳定时器（每2分钟发送一次"我还活着"）
  const heartbeatInterval = setInterval(() => {
    const elapsed = ((Date.now() - totalStart) / 1000 / 60).toFixed(1);
    sendProgress(`💓 任务进行中... 当前步骤: ${currentStep} | 已运行 ${elapsed} 分钟`);
  }, 120000); // 2分钟
  
  // 检查并自动安装 Playwright
  if (!checkPlaywright()) {
    console.log('\n⚠️ 警告: Playwright 未安装或浏览器未下载');
    const installed = await installPlaywright();
    if (!installed) {
      console.log('   继续执行（封面生成可能失败）...\n');
    }
  }
  
  // 步骤1: 搜索
  currentStep = '搜索热点';
  sendProgress('📱 步骤 1/4：正在搜索全网热点（微博、知乎、B站、小红书、Twitter）...');
  startTimer('步骤1-热点搜索');
  const hotspots = await fetchAllHotspots();
  endTimer('步骤1-热点搜索');
  sendProgress(`✅ 步骤 1/4 完成！共收集 ${hotspots.length} 条热点`);
  
  // 步骤2: 分析
  currentStep = 'AI评估话题';
  sendProgress('🤖 步骤 2/4：AI 正在评估热点，选出最佳话题...');
  startTimer('步骤2-AI分析');
  const topics = await analyzeAndSelect(hotspots);
  endTimer('步骤2-AI分析');
  sendProgress(`✅ 步骤 2/4 完成！选出 ${topics.length} 个话题：${topics.map(t => t.title.slice(0, 20)).join('、')}...`);
  
  // 步骤3: 生成文章
  currentStep = '生成文章（约5-8分钟）';
  sendProgress('✍️ 步骤 3/4：正在生成文章（根据内存自动选择串行/并行模式）...');
  startTimer('步骤3-文章生成(并行)');
  const articles = await generateArticles(topics);
  endTimer('步骤3-文章生成(并行)');
  const successCount = articles.filter(a => a.success).length;
  sendProgress(`✅ 步骤 3/4 完成！成功生成 ${successCount}/${articles.length} 篇文章`);
  
  // 步骤4: 发布
  if (articles.length > 0) {
    currentStep = '发布到公众号';
    sendProgress('📤 步骤 4/4：正在发布到微信公众号草稿箱...');
    startTimer('步骤4-发布(串行)');
    await publishArticles(articles);
    endTimer('步骤4-发布(串行)');
  }
  
  // 停止心跳
  clearInterval(heartbeatInterval);
  
  const totalDuration = ((Date.now() - totalStart) / 1000 / 60).toFixed(1);
  
  // 发送完成通知
  const successArticles = articles.filter(a => a.success);
  if (successArticles.length > 0) {
    const titles = successArticles.map(a => `「${(a.title || a.topic || '未命名').slice(0, 15)}...」`).join('\n   ');
    sendProgress(`🎉 全部完成！总耗时 ${totalDuration} 分钟\n\n📊 成功生成 ${successArticles.length} 篇文章：\n   ${titles}\n\n📱 请前往微信公众号后台草稿箱查看`);
  } else {
    sendProgress(`⚠️ 任务完成，但文章生成失败，请检查日志`);
  }
  
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
