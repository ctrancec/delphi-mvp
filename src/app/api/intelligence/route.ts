import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'

// Initialize OpenAI client pointing to Perplexity API
const pplx = new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY || "Missing_Key",
    baseURL: 'https://api.perplexity.ai'
})

const CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'delphi-news-cache.json')
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 Hours

export async function POST(req: Request) {
    try {
        const { topics, forceRefresh } = await req.json()
        const topicQuery = topics && topics.length > 0 ? topics.join(', ') : "Future of Tech & Coffee"

        // --- 1. CHECK CACHE ---
        try {
            await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
            const cacheRaw = await fs.readFile(CACHE_FILE, 'utf-8')
            const cache = JSON.parse(cacheRaw)

            const isFresh = (Date.now() - cache.timestamp) < CACHE_TTL_MS
            const sameTopics = cache.topicQuery === topicQuery

            if (isFresh && sameTopics && !forceRefresh) {
                console.log("Serving from Cache ⚡")
                return NextResponse.json(cache.data)
            }
        } catch (e) {
            // Cache miss or read error, proceed to fetch
        }

        // --- 2. FETCH REAL DATA ---
        // Perplexity 'sonar-pro' has internet access. We just ask it to do the research.
        const prompt = `
        You are an elite business intelligence engine.
        Generate a "Daily Briefing" JSON object containing 4 HIGH-QUALITY, REAL-TIME news stories relevant to: ${topicQuery}.
        
        INSTRUCTIONS:
        1. Search the web for the most impactful recent stories (last 48 hours) for these topics.
        2. Select 1 "hero" story (major impact) and 3 "trending" stories.
        3. Write a DEEP, COMPREHENSIVE report for each (300-500 words).
           - Do not just summarize. Explain the *Implications*, *Context*, and *Why it matters*.
           - Use Markdown headers (###) and bullet points.
        4. CITE YOUR SOURCES. Provide real URLs found during your search.
        
        OUTPUT SCHEMA (Strict JSON):
        {
            "stories": [
                {
                    "id": "unique_id", // Generate a random string/UUID
                    "type": "hero",
                    "category": "Category",
                    "title": "Headline",
                    "summary": "Short snippet",
                    "image": "gradient-string",
                    "readTime": "5 min read",
                    "date": "Today",
                    "tags": ["Tag"],
                    "sources": [{ "name": "Source", "url": "URL" }],
                    "content": "### Executive Summary..."
                }
            ]
        }
        `

        const completion = await pplx.chat.completions.create({
            model: "sonar-pro", // High reasoning, online model
            messages: [
                { role: "system", content: "You are a helpful AI assistant that outputs strictly valid JSON." },
                { role: "user", content: prompt }
            ],
            // Perplexity doesn't support 'response_format: json_object' natively in all models, 
            // but usually follows instructions well. We will parse carefully.
        })

        // Clean and parse
        let rawContent = completion.choices[0].message.content || "{}"
        // Remove markdown code blocks if present
        rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '')

        const data = JSON.parse(rawContent)

        // --- 3. SAVE TO CACHE ---
        await fs.writeFile(CACHE_FILE, JSON.stringify({
            timestamp: Date.now(),
            topicQuery,
            data
        }, null, 2))

        return NextResponse.json(data)

    } catch (error: any) {
        console.error("Perplexity Intelligence Error:", error)
        return NextResponse.json({ error: "Failed to fetch from Perplexity. Ensure PERPLEXITY_API_KEY is set." }, { status: 500 })
    }
}
