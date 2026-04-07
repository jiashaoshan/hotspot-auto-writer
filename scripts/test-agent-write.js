#!/usr/bin/env node
/**
 * 测试笔杆子 agent 端到端：生成文章 → 发布到草稿箱
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

// 路径
const SKILLS_DIR = path.join(os.homedir(), '.openclaw/workspace/skills');
const WP_CONTEXT = path.join(SKILLS_DIR, 'wechat-prompt-context');
const HOTSPOT = path.join(SKILLS_DIR, 'hotspot-auto-writer');

// 加载发布工具
const mpPublisherPath = path.join(SKILLS_DIR, 'wechat-mp-publisher');
const toolkitPath = path.join(SKILLS_DIR, 'wechat-toolkit');
const hasMpPublisher = fs.existsSync(path.join(mpPublisherPath, 'scripts', 'publish.js'));
const hasToolkit = fs.existsSync(path.join(toolkitPath, 'scripts', 'publish.js'));

console.log('=== 笔杆子 agent 端到端测试 ===\n');
console.log(`wechat-mp-publisher: ${hasMpPublisher ? '✅' : '❌'}`);
console.log(`wechat-toolkit: ${hasToolkit ? '✅' : '❌'}\n`);

// 步骤1: 生成提示词
const topic = '为什么年轻人越来越不敢结婚';
const prompt = `写一篇关于年轻人不敢结婚的公众号文章。

角度：从经济压力、个人成长、社交方式变化三个维度分析
风格：理性分析+温情共情，避免说教和制造焦虑
结构：
  - 开头：用一个具体场景/故事引入
  - 主体：3个核心论点，每个配具体案例
  - 结尾：温和收尾，不要呼吁行动

目标读者：25-35岁年轻人`;

const promptPath = path.join(WP_CONTEXT, 'output', 'test-prompt.txt');
fs.writeFileSync(promptPath, prompt, 'utf8');
console.log(`1️⃣ 提示词已写入：${promptPath}`);

// 步骤2: 调用笔杆子生成文章
console.log('\n2️⃣ 调用笔杆子 agent 生成文章...');
try {
  const result = execSync(
    `node ${WP_CONTEXT}/scripts/write-article.js ${promptPath} "${topic}"`,
    {
      cwd: WP_CONTEXT,
      timeout: 600000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf8',
      stdio: 'inherit'
    }
  );
  console.log('✅ 文章生成完成');
} catch (e) {
  console.log(`❌ 生成失败：${e.message}`);
  process.exit(1);
}

// 步骤3: 检查生成的文章
const articlePath = path.join(WP_CONTEXT, 'output', 'article.md');
if (!fs.existsSync(articlePath)) {
  console.log(`❌ 文章文件不存在：${articlePath}`);
  process.exit(1);
}

const content = fs.readFileSync(articlePath, 'utf8');
const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
const body = bodyMatch ? bodyMatch[1] : content;
const wordCount = body.replace(/\s/g, '').length;
console.log(`\n3️⃣ 文章检查：`);
console.log(`   字数：${wordCount}`);
console.log(`   字数达标：${wordCount >= 1500 ? '✅' : '❌'}`);

if (wordCount < 1500) {
  console.log('❌ 字数不足，终止发布');
  process.exit(1);
}

// 步骤4: 发布到草稿箱
console.log('\n4️⃣ 发布到微信公众号草稿箱...');

// 解析封面路径
const coverMatch = content.match(/cover:\s*["']?([^\n"']+)["']?/);
let coverPath = coverMatch ? coverMatch[1].trim() : null;
if (coverPath && !path.isAbsolute(coverPath)) {
  coverPath = path.join(WP_CONTEXT, 'output', coverPath);
}

// 调用 wechat-prompt-context 的发布流程
const publishScript = path.join(WP_CONTEXT, 'scripts', 'publish.js');
if (fs.existsSync(publishScript)) {
  console.log(`   使用 wechat-prompt-context 的发布脚本...`);
  try {
    const publishResult = execSync(
      `node ${publishScript} ${articlePath}`,
      {
        cwd: WP_CONTEXT,
        timeout: 120000,
        encoding: 'utf8',
        stdio: 'inherit'
      }
    );
    console.log('✅ 发布成功');
  } catch (e) {
    console.log(`❌ 发布失败：${e.message}`);
  }
} else if (hasMpPublisher) {
  console.log(`   使用 wechat-mp-publisher...`);
  try {
    const publishCmd = `node ${path.join(mpPublisherPath, 'scripts', 'publish.js')} ${articlePath}`;
    execSync(publishCmd, {
      cwd: WP_CONTEXT,
      timeout: 120000,
      encoding: 'utf8',
      stdio: 'inherit'
    });
    console.log('✅ 发布成功');
  } catch (e) {
    console.log(`❌ 发布失败：${e.message}`);
  }
} else {
  console.log('❌ 没有找到可用的发布脚本');
}

console.log('\n=== 测试完成 ===');
