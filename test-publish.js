#!/usr/bin/env node
/**
 * 测试发布并行功能
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

// 异步执行命令
function runAsync(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 启动: ${cmd.slice(0, 60)}...`);
    
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
    
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`超时 (${timeout}ms)`));
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] 完成 (${duration}ms): 退出码 ${code}`);
      if (code === 0) {
        resolve({ stdout, duration });
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

async function testPublishParallel() {
  console.log('\n🚀 测试发布并行功能\n');
  
  // 准备两篇文章
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, 'output', today);
  
  // 检查文章是否存在
  const article1 = path.join(outputDir, 'article-1.md');
  const article2 = path.join(outputDir, 'article-2.md');
  
  if (!fs.existsSync(article1)) {
    console.log('❌ 文章1不存在:', article1);
    return;
  }
  if (!fs.existsSync(article2)) {
    console.log('❌ 文章2不存在:', article2);
    return;
  }
  
  console.log('✅ 找到两篇文章');
  console.log('  文章1:', article1);
  console.log('  文章2:', article2);
  
  const toolkitPath = path.join(os.homedir(), '.openclaw/workspace/skills/wechat-toolkit/scripts/publisher/publish.js');
  
  console.log('\n⏱️ 开始并行发布...\n');
  const startTime = Date.now();
  
  // 并行发布两篇文章
  const publishPromises = [
    runAsync(`node "${toolkitPath}" "${article1}" pie`, 120000),
    runAsync(`node "${toolkitPath}" "${article2}" pie`, 120000)
  ];
  
  try {
    const results = await Promise.all(publishPromises);
    const totalTime = Date.now() - startTime;
    
    console.log('\n✅ 全部发布完成！');
    console.log(`⏱️ 总耗时: ${totalTime}ms (${(totalTime/1000).toFixed(1)}秒)`);
    console.log(`  文章1耗时: ${results[0].duration}ms`);
    console.log(`  文章2耗时: ${results[1].duration}ms`);
    console.log(`  节省时间: ${results[0].duration + results[1].duration - totalTime}ms (并行优势)`);
    
  } catch (e) {
    console.error('\n❌ 发布失败:', e.message);
  }
}

testPublishParallel();
