#!/usr/bin/env node
/**
 * 文章生成工作进程（独立进程，资源隔离）
 * 由主进程通过 spawn 启动
 * 通信方式：stdout JSON 结果
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 解析参数
const args = {};
process.argv.slice(2).forEach(arg => {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) {
    args[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
});

async function main() {
  const topic = args.topic;
  const type = args.type || 'analysis';
  const rank = args.rank || '1';
  const outputDir = args['output-dir'] || path.join(__dirname, '../output');
  
  if (!topic) {
    console.error(JSON.stringify({ success: false, error: '缺少 topic 参数' }));
    process.exit(1);
  }
  
  // 创建临时目录
  const tmpDir = path.join('/tmp', `wpc-worker-${rank}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  
  try {
    const wpcSourcePath = path.join(process.env.HOME || '/Users/jiashaoshan', '.openclaw/workspace/skills/wechat-prompt-context');
    
    // 复制必要文件
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'output'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'prompts'), { recursive: true });
    
    // 复制脚本
    const scripts = ['write-article.js', 'analyze.js', 'research.js', 'cover.js'];
    scripts.forEach(script => {
      const src = path.join(wpcSourcePath, 'scripts', script);
      const dst = path.join(tmpDir, 'scripts', script);
      if (fs.existsSync(src)) {
        let content = fs.readFileSync(src, 'utf8');
        // 修复路径引用：wechat-ai-writer -> wai-scripts
        if (script === 'write-article.js') {
          content = content.replace(
            /require\(['"]\.\.\/\.\.\/wechat-ai-writer\/scripts\//g,
            "require('./wai-scripts/"
          );
        }
        fs.writeFileSync(dst, content);
      }
    });
    
    // 复制 wechat-ai-writer 脚本
    const waiSourcePath = path.join(process.env.HOME || '/Users/jiashaoshan', '.openclaw/workspace/skills/wechat-ai-writer');
    const waiScriptsDir = path.join(tmpDir, 'scripts', 'wai-scripts');
    fs.mkdirSync(waiScriptsDir, { recursive: true });
    const waiScripts = ['generate-cover.js', 'llm-client.js', 'doubao-image.js', 'pexels-image.js'];
    waiScripts.forEach(script => {
      const src = path.join(waiSourcePath, 'scripts', script);
      const dst = path.join(waiScriptsDir, script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    });
    
    // 复制 prompts
    if (fs.existsSync(path.join(wpcSourcePath, 'prompts'))) {
      const items = fs.readdirSync(path.join(wpcSourcePath, 'prompts'));
      items.forEach(item => {
        const src = path.join(wpcSourcePath, 'prompts', item);
        const dst = path.join(tmpDir, 'prompts', item);
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.copyFileSync(src, dst);
        }
      });
    }
    
    // 复制 .env
    if (fs.existsSync(path.join(wpcSourcePath, '.env'))) {
      fs.copyFileSync(
        path.join(wpcSourcePath, '.env'),
        path.join(tmpDir, '.env')
      );
    }
    
    // 复制 node_modules
    const nodeModulesDir = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    
    const deps = ['js-yaml', 'argparse'];
    deps.forEach(dep => {
      try {
        const depPath = require.resolve(dep);
        const depRoot = depPath.substring(0, depPath.indexOf('node_modules') + 'node_modules'.length);
        const src = path.join(depRoot, dep);
        const dst = path.join(nodeModulesDir, dep);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.cpSync(src, dst, { recursive: true });
        }
      } catch (e) {}
    });
    
    // 创建 package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'wpc-worker', version: '1.0.0', private: true }, null, 2)
    );
    
    // 创建提示词文件
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
    
    fs.writeFileSync(path.join(tmpDir, 'prompt.txt'), promptContent);
    
    // 执行生成
    const startTime = Date.now();
    
    try {
      execSync(
        `node "${path.join(tmpDir, 'scripts/write-article.js')}" "${path.join(tmpDir, 'prompt.txt')}" "${topic}"`,
        { 
          cwd: tmpDir,
          stdio: 'inherit', // 改为inherit，实时看到输出
          timeout: 600000,
          maxBuffer: 50 * 1024 * 1024
        }
      );
    } catch (e) {
      console.error(`[Worker] 生成失败: ${e.message}`);
      // 检查是否有输出文件（可能是超时但已生成部分内容）
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // 检查输出 - 从 workspace-creator 读取 agent 生成的文件
    const creatorWorkspace = path.join(process.env.HOME || '/Users/jiashaoshan', '.openclaw/workspace-creator');
    
    // 获取最新的 .md 文件（按修改时间排序）
    const mdFiles = fs.readdirSync(creatorWorkspace)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'))
      .map(f => ({
        name: f,
        path: path.join(creatorWorkspace, f),
        mtime: fs.statSync(path.join(creatorWorkspace, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (mdFiles.length === 0) {
      throw new Error('未在 workspace-creator 找到生成的文章文件');
    }
    
    // 使用最新的文件（可能是这次生成的）
    const outputFile = mdFiles[0].path;
    console.log(`[Worker] 从 workspace-creator 读取文章: ${outputFile}`);
    
    let content = fs.readFileSync(outputFile, 'utf8');
    
    // 验证字数
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
    
    // 保存到最终位置
    fs.mkdirSync(outputDir, { recursive: true });
    
    const finalArticlePath = path.join(outputDir, `article-${rank}.md`);
    const finalCoverPath = path.join(outputDir, `cover-${rank}.jpg`);
    
    // 更新封面路径为相对路径
    content = content.replace(
      /cover:\s*["']?[^\n"']+["']?/,
      `cover: "cover-${rank}.jpg"`
    );
    fs.writeFileSync(finalArticlePath, content);
    
    // 复制封面（从 workspace-creator 搜索）
    let coverSrc = null;
    const searchDirs = [
      creatorWorkspace,
      path.join(tmpDir, 'output'),
      path.join(tmpDir, 'scripts', 'output'),
      path.join(tmpDir, 'scripts', 'wai-scripts', 'output')
    ];
    
    for (const searchDir of searchDirs) {
      if (fs.existsSync(searchDir)) {
        const files = fs.readdirSync(searchDir);
        const coverFile = files.find(f => f.startsWith('cover') && (f.endsWith('.jpg') || f.endsWith('.png')));
        if (coverFile) {
          coverSrc = path.join(searchDir, coverFile);
          console.log(`[Worker] 找到封面: ${coverSrc}`);
          break;
        }
      }
    }
    
    if (coverSrc && fs.existsSync(coverSrc)) {
      fs.copyFileSync(coverSrc, finalCoverPath);
      console.log(`[Worker] 封面已复制: ${coverSrc} -> ${finalCoverPath}`);
    } else {
      console.log(`[Worker] ⚠️ 未找到封面文件（搜索了${searchDirs.length}个目录）`);
    }
    
    // 输出结果（JSON格式）
    console.log(JSON.stringify({
      success: true,
      rank: parseInt(rank),
      topic: topic,
      articlePath: finalArticlePath,
      coverPath: finalCoverPath,
      wordCount: wordCount,
      duration: parseFloat(duration)
    }));
    
  } catch (e) {
    console.error(JSON.stringify({
      success: false,
      rank: parseInt(rank),
      topic: topic,
      error: e.message
    }));
    process.exit(1);
  } finally {
    // 清理
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

main();
