
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { ArrowLeft } from 'lucide-react'

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30 font-sans">
            <nav className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="font-bold text-xl tracking-tighter hover:text-cyan-400 transition-colors">Delphi</Link>
                    <Link href="/">
                        <Button variant="ghost" size="sm" className="gap-2 text-gray-400 hover:text-white">
                            <ArrowLeft className="h-4 w-4" /> Back to Home
                        </Button>
                    </Link>
                </div>
            </nav>

            <main className="max-w-3xl mx-auto px-6 py-16">
                <h1 className="text-4xl font-bold mb-2 tracking-tight">Terms of Service</h1>
                <p className="text-gray-400 mb-12">Last Updated: January 17, 2026</p>

                <div className="prose prose-invert prose-blue max-w-none space-y-8 text-gray-300">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">1. Acceptance of Terms</h2>
                        <p>
                            By accessing or using the Delphi platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of the terms, you may not access the Service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">2. Description of Service</h2>
                        <p>
                            Delphi provides financial intelligence, POS integration, and business management tools. We reserve the right to modify, suspend, or discontinue the Service at any time without notice.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">3. AI & Data Accuracy</h2>
                        <p>
                            Our Intelligence Engine uses artificial intelligence to generate reports. While we strive for accuracy:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 mt-2">
                            <li>AI-generated content may contain errors or inaccuracies.</li>
                            <li>Financial data provided is for informational purposes only and should not be considered professional financial advice.</li>
                            <li>You are responsible for verifying all critical information before making business decisions.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">4. Subscriptions & Billing</h2>
                        <p>
                            Subscriptions are billed in advance on a monthly basis. You may cancel your subscription at any time; however, there are no refunds for partial months of service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">5. Limitation of Liability</h2>
                        <p>
                            In no event shall Delphi, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.
                        </p>
                    </section>
                </div>
            </main>

            <footer className="border-t border-white/5 py-8 mt-20 text-center text-sm text-gray-500">
                &copy; 2026 Delphi Finance. All rights reserved.
            </footer>
        </div>
    )
}
