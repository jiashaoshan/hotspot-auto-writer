#!/usr/bin/env node
/**
 * 子Agent：单篇文章生成
 * 由主Agent通过 sessions_spawn 调用
 * 参数：--topic="话题" --type="类型" --output-dir="输出目录"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
  return args;
}

async function main() {
  const args = parseArgs();
  const topic = args.topic;
  const type = args.type || 'analysis';
  const outputDir = args['output-dir'] || path.join(__dirname, '../output');
  
  if (!topic) {
    console.error('❌ 缺少 --topic 参数');
    process.exit(1);
  }
  
  console.log(`📝 [子Agent] 开始生成文章`);
  console.log(`   话题: ${topic}`);
  console.log(`   类型: ${type}`);
  console.log(`   输出: ${outputDir}`);
  
  // 创建临时目录
  const tmpDir = path.join('/tmp', `wpc-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  
  try {
    // 复制 wechat-prompt-context 到临时目录
    const wpcSource = path.join(__dirname, '../../wechat-prompt-context');
    
    // 复制必要文件
    const filesToCopy = [
      'scripts/write-article.js',
      'scripts/analyze.js',
      'scripts/research.js',
      'scripts/cover.js',
      'prompts',
      '.env'
    ];
    
    filesToCopy.forEach(file => {
      const src = path.join(wpcSource, file);
      const dst = path.join(tmpDir, file);
      if (fs.existsSync(src)) {
        if (fs.statSync(src).isDirectory()) {
          execSync(`cp -r "${src}" "${dst}"`, { stdio: 'ignore' });
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
      }
    });
    
    // 复制 node_modules（关键依赖）
    const deps = ['js-yaml', 'argparse'];
    deps.forEach(dep => {
      try {
        const depPath = require.resolve(dep);
        const depRoot = depPath.match(/.*node_modules/)[0];
        const src = path.join(depRoot, dep);
        const dst = path.join(tmpDir, 'node_modules', dep);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          execSync(`cp -r "${src}" "${dst}"`, { stdio: 'ignore' });
        }
      } catch (e) {
        // 忽略复制错误
      }
    });
    
    // 创建 package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'wpc-sub', version: '1.0.0', private: true }, null, 2)
    );
    
    // 生成提示词文件
    const promptContent = `你是一位资深微信公众号文章作者，擅长写${type}类文章。

任务：为以下话题撰写一篇深度文章。

话题：${topic}

要求：
1. 开头用具体场景或故事引入
2. 内容深度剖析，不只是表面描述
3. 提供实用建议或独到见解
4. 语言风格：理性中带温度，专业但不晦涩
5. 字数：2000-3000字
6. 结构清晰，有小标题
7. 结尾要有总结和行动建议

请直接输出完整的Markdown格式文章内容（不需要frontmatter）。`;
    
    const promptPath = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptPath, promptContent);
    
    // 执行生成
    console.log(`   [子Agent] 调用 write-article.js...`);
    const startTime = Date.now();
    
    try {
      execSync(
        `cd "${tmpDir}" && node scripts/write-article.js "${promptPath}" "${topic}"`,
        { 
          stdio: 'inherit',
          timeout: 600000, // 10分钟超时
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }
      );
    } catch (e) {
      if (e.message.includes('字数') || e.message.includes('乱码')) {
        console.error(`   [子Agent] ❌ 文章验证失败: ${e.message}`);
        throw e;
      }
      // 其他错误可能是超时，继续检查是否有输出
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   [子Agent] 生成耗时: ${duration}秒`);
    
    // 检查输出文件
    const outputFile = path.join(tmpDir, 'output', 'article.md');
    if (!fs.existsSync(outputFile)) {
      throw new Error('未找到生成的文章文件');
    }
    
    const content = fs.readFileSync(outputFile, 'utf8');
    
    // 验证内容完整性
    const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : content;
    const wordCount = body.replace(/\s/g, '').length;
    
    if (wordCount < 1500) {
      throw new Error(`字数不足: ${wordCount} < 1500`);
    }
    
    // 检查乱码
    if (/[\uFFFD]|�/.test(body)) {
      throw new Error('检测到乱码字符');
    }
    
    // 复制到最终输出目录
    const rank = args.rank || '1';
    const finalArticlePath = path.join(outputDir, `article-${rank}.md`);
    const finalCoverPath = path.join(outputDir, `cover-${rank}.jpg`);
    
    fs.mkdirSync(outputDir, { recursive: true });
    
    // 读取文章并更新封面路径为相对路径
    let articleContent = fs.readFileSync(outputFile, 'utf8');
    articleContent = articleContent.replace(
      /cover:\s*["']?[^\n"']+["']?/,
      `cover: "cover-${rank}.jpg"`
    );
    fs.writeFileSync(finalArticlePath, articleContent);
    
    // 复制封面
    const coverSrc = path.join(tmpDir, 'output', 'cover.jpg');
    if (fs.existsSync(coverSrc)) {
      fs.copyFileSync(coverSrc, finalCoverPath);
    }
    
    console.log(`   [子Agent] ✅ 生成成功`);
    console.log(`   [子Agent]   文章: ${finalArticlePath}`);
    console.log(`   [子Agent]   字数: ${wordCount}`);
    
    // 返回结果（stdout）
    console.log(`\nSUBAGENT_RESULT: ${JSON.stringify({
      success: true,
      articlePath: finalArticlePath,
      coverPath: finalCoverPath,
      wordCount: wordCount,
      duration: duration
    })}`);
    
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }
  }
}

main().catch(err => {
  console.error(`   [子Agent] ❌ 失败: ${err.message}`);
  console.log(`\nSUBAGENT_RESULT: ${JSON.stringify({
    success: false,
    error: err.message
  })}`);
  process.exit(1);
});
