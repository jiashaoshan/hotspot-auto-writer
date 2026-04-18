/**
 * 热点自动写作 - 提示词配置文件
 * 优化版评估框架
 */

module.exports = {
  // 简化版提示词模板
  topicSelectionPrompt: `你是一位资深公众号主编，请从以下热点中选出2个最适合写深度文章的选题。

热点列表：
{{hotspots}}

选择标准（满足3条以上）：
1. 有深度：能写出2500-3000字，有多个分析角度
2. 有观点：不是简单复述新闻，有独特见解
3. 有价值：能给读者认知增量或情绪共鸣
4. 有时效：热点类24-48小时内有效，或长期有价值
5. 安全：无政治敏感，无法律风险

请直接输出JSON格式：
{
  "topics": [
    {
      "rank": 1,
      "title": "文章标题（吸引人）",
      "source": "来源平台",
      "angle": "切入角度（一句话）",
      "articleType": "opinion/analysis/story",
      "targetAudience": "目标读者",
      "sellingPoint": "核心卖点"
    },
    {
      "rank": 2,
      "title": "...",
      "source": "...",
      "angle": "...",
      "articleType": "...",
      "targetAudience": "...",
      "sellingPoint": "..."
    }
  ]
}

只输出JSON，不要其他文字。`,

  // 文章生成配置
  articleGeneration: {
    defaultType: "opinion",
    types: {
      opinion: {
        name: "观点型",
        wordCount: { min: 2500, max: 3500 }
      },
      analysis: {
        name: "分析型",
        wordCount: { min: 2500, max: 3500 }
      }
    }
  },

  // 搜索配置
  search: {
    limits: {
      bilibili: 10,
      xiaohongshu: 8,
      twitter: 8
    }
  }
};
