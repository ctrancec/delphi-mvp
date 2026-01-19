import { MetadataRoute } from 'next'
import { SOLUTIONS_DATA } from '@/lib/seo-data'

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = 'https://delphi.com' // Replace with actual production domain

    // 1. Core Static Routes
    const routes = [
        '',
        '/login',
        '/signup',
        '/dashboard',
        '/pricing',
    ].map((route) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date(),
        changeFrequency: 'monthly' as const,
        priority: route === '' ? 1 : 0.8,
    }))

    // 2. Programmatic SEO Routes (Solutions)
    const solutionRoutes = Object.keys(SOLUTIONS_DATA).map((industry) => ({
        url: `${baseUrl}/solutions/${industry}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.9, // High priority landing pages
    }))

    return [...routes, ...solutionRoutes]
}
