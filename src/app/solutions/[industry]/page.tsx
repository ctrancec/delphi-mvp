import { Metadata } from 'next'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, ArrowRight, Star, BarChart3, Users, Zap } from 'lucide-react'
import Link from 'next/link'
import { SOLUTIONS_DATA, GENERIC_DATA } from '@/lib/seo-data'

type Props = {
    params: Promise<{ industry: string }>
}

// 1. Dynamic Metadata for SEO
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { industry } = await params
    const data = SOLUTIONS_DATA[industry] || GENERIC_DATA(industry)
    const displayIndustry = industry.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

    return {
        title: `${data.title} | Delphi Solutions`,
        description: data.description,
        openGraph: {
            title: `Delphi for ${displayIndustry}`,
            description: data.subtitle,
        }
    }
}

// 2. Static Generation for popular routes (Build time speed)
export function generateStaticParams() {
    return Object.keys(SOLUTIONS_DATA).map((industry) => ({ industry }))
}

// 3. The Page Component
export default async function IndustrySolutionPage({ params }: Props) {
    const { industry } = await params
    const data = SOLUTIONS_DATA[industry] || GENERIC_DATA(industry)
    const displayIndustry = industry.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            {/* Navbar Placeholder */}
            <nav className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <span className="font-bold text-xl tracking-tighter">Delphi</span>
                    <div className="flex gap-4">
                        <Link href="/login">
                            <Button variant="ghost" className="text-gray-400 hover:text-white">Log in</Button>
                        </Link>
                        <Link href="/signup">
                            <Button className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold">Get Started</Button>
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-20 pb-32 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-black to-black" />

                <div className="max-w-5xl mx-auto px-4 relative z-10 text-center space-y-8">
                    <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 uppercase tracking-widest text-[10px] py-1 px-3">
                        Solutions for {displayIndustry}
                    </Badge>

                    <h1 className="text-5xl md:text-7xl font-bold tracking-tight bg-gradient-to-br from-white via-white to-gray-500 bg-clip-text text-transparent pb-2">
                        {data.title}
                    </h1>

                    <p className="text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
                        {data.subtitle} <br />
                        <span className="text-gray-500 text-lg mt-4 block">{data.description}</span>
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                        <Link href="/signup">
                            <Button size="lg" className="h-12 px-8 text-lg bg-white text-black hover:bg-gray-200">
                                Start Free Trial <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                        <Button variant="outline" size="lg" className="h-12 px-8 border-white/10 hover:bg-white/5">
                            View Live Demo
                        </Button>
                    </div>

                    <div className="pt-8 flex items-center justify-center gap-2 text-sm text-gray-500">
                        <div className="flex text-yellow-500">
                            {[1, 2, 3, 4, 5].map(i => <Star key={i} className="h-4 w-4 fill-current" />)}
                        </div>
                        <span>Trusted by 500+ {displayIndustry} businesses</span>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section className="py-24 border-t border-white/5 bg-zinc-950/50">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {data.features.map((feature, i) => (
                            <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-colors">
                                <div className="h-10 w-10 rounded-full bg-cyan-500/10 flex items-center justify-center mb-4">
                                    <Check className="h-5 w-5 text-cyan-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">{feature}</h3>
                                <p className="text-sm text-gray-500">
                                    Optimized specifically for the needs of {displayIndustry} workflows.
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Value Props */}
            <section className="py-24">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                        <div className="space-y-4">
                            <BarChart3 className="h-8 w-8 text-cyan-400" />
                            <h3 className="text-2xl font-bold">Real-time Analytics</h3>
                            <p className="text-gray-400">See your profit, loss, and margins instantly. No more waiting for end-of-month reports.</p>
                        </div>
                        <div className="space-y-4">
                            <Users className="h-8 w-8 text-purple-400" />
                            <h3 className="text-2xl font-bold">Team Management</h3>
                            <p className="text-gray-400">Handle payroll, scheduling, and permissions without leaving the platform.</p>
                        </div>
                        <div className="space-y-4">
                            <Zap className="h-8 w-8 text-yellow-400" />
                            <h3 className="text-2xl font-bold">Automated Sync</h3>
                            <p className="text-gray-400">Connects with your bank, Stripe, and POS to automate 90% of data entry.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* SEO Footer Links (Internal Linking Strategy) */}
            <section className="py-12 border-t border-white/5">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <p className="text-sm text-gray-600 mb-4">Explore other solutions</p>
                    <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-500">
                        {Object.keys(SOLUTIONS_DATA).map(key => (
                            <Link key={key} href={`/solutions/${key}`} className="hover:text-cyan-400 transition-colors">
                                For {key.replace('-', ' ')}
                            </Link>
                        ))}
                        <Link href="/solutions/dentist" className="hover:text-cyan-400 transition-colors">For Dentists</Link>
                        <Link href="/solutions/law-firm" className="hover:text-cyan-400 transition-colors">For Law Firms</Link>
                    </div>
                </div>
            </section>
        </div>
    )
}
