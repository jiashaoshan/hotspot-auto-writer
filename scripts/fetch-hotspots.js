#!/usr/bin/env node
/**
 * 全渠道热点获取脚本（带Cookie支持）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 加载Cookie
function loadCookies(platform) {
  try {
    const cookiePath = path.join(__dirname, '../.cookies', `${platform}_cookies.json`);
    if (!fs.existsSync(cookiePath)) return null;
    return JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 格式化为curl header
function formatCookieHeader(cookies) {
  if (!cookies || !Array.isArray(cookies)) return '';
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

// 执行curl命令
function curl(url, headers = {}, timeout = 15000) {
  try {
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v}"`)
      .join(' ');
    const cmd = `curl -s ${headerArgs} "${url}" 2>/dev/null`;
    return execSync(cmd, { timeout, encoding: 'utf8' });
  } catch (e) {
    return null;
  }
}

// 获取微博热搜
async function fetchWeibo() {
  const cookies = loadCookies('weibo');
  const cookieHeader = formatCookieHeader(cookies);
  
  try {
    const cmd = `curl -s -H 'Cookie: ${cookieHeader}' -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' -H 'Referer: https://weibo.com/' 'https://weibo.com/ajax/side/hotSearch' 2>/dev/null`;
    const result = execSync(cmd, { timeout: 15000, encoding: 'utf8' });
    
    if (!result) return [];
    
    const data = JSON.parse(result);
    if (data.data?.realtime) {
      return data.data.realtime.slice(0, 10).map((item, i) => ({
        platform: '微博',
        title: item.word?.toString() || '',
        hot: item.num || (100 - i * 5),
        category: item.category || '热搜'
      })).filter(h => h.title);
    }
  } catch (e) {
    console.log('      微博错误:', e.message);
  }
  return [];
}

// 获取知乎热榜
async function fetchZhihu() {
  const cookies = loadCookies('zhihu');
  const cookieHeader = formatCookieHeader(cookies);
  const result = curl('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=20',
    cookieHeader ? { 'Cookie': cookieHeader } : {},
    15000
  );
  
  if (!result) return [];
  
  try {
    const data = JSON.parse(result);
    if (data.data) {
      return data.data.slice(0, 10).map((item, i) => {
        const target = item.target || {};
        const title = target.title || target.question?.title || '';
        const hotText = item.detail_text || '';
        const hot = parseInt(hotText.replace(/[^\d]/g, '')) || (100 - i * 5);
        return {
          platform: '知乎',
          title: title.toString(),
          hot,
          category: '热榜'
        };
      }).filter(h => h.title);
    }
  } catch (e) {}
  return [];
}

// 主函数
async function main() {
  console.log('\n🔥 获取全渠道热点\n');
  
  const allHotspots = [];
  
  console.log('   📱 微博热搜...');
  const weibo = await fetchWeibo();
  console.log(`      ✅ ${weibo.length} 条`);
  allHotspots.push(...weibo);
  
  console.log('   📚 知乎热榜...');
  const zhihu = await fetchZhihu();
  console.log(`      ✅ ${zhihu.length} 条`);
  allHotspots.push(...zhihu);
  
  // 保存结果
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(__dirname, '../output', today);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'hotspots.json'),
    JSON.stringify({ date: today, hotspots: allHotspots }, null, 2)
  );
  
  console.log(`\n   📊 总计: ${allHotspots.length} 条热点`);
  return allHotspots;
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, fetchWeibo, fetchZhihu };
