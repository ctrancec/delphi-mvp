
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPage() {
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
                <h1 className="text-4xl font-bold mb-2 tracking-tight">Privacy Policy</h1>
                <p className="text-gray-400 mb-12">Last Updated: January 17, 2026</p>

                <div className="prose prose-invert prose-blue max-w-none space-y-8 text-gray-300">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">1. Data Collection</h2>
                        <p>
                            We collect information you provide directly to us, such as when you create an account, connect a bank account, or interact with our customer support. This may include:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 mt-2">
                            <li>Contact information (email, name)</li>
                            <li>Financial data (transaction history, account balances) via secure providers (Plaid/Stripe)</li>
                            <li>Usage data (how you interact with our dashboard)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">2. How We Use Your Data</h2>
                        <p>
                            We use your data strictly to provide and improve the Delphi service. We do <strong>not</strong> sell your personal data to third parties. We use your data to:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 mt-2">
                            <li>Generate financial insights and reports.</li>
                            <li>Process payments and subscriptions.</li>
                            <li>Send critical security alerts and updates.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">3. Data Security</h2>
                        <p>
                            We implement industry-standard security measures, including AES-256 encryption at rest and in transit. However, no method of transmission over the Internet is 100% secure.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">4. Third-Party Services</h2>
                        <p>
                            We use third-party services like OpenAI and Perplexity to power our Intelligence Engine. When you use AI features, anonymized queries (not personal financial data) may be processed by these providers.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-4">5. Contact Us</h2>
                        <p>
                            If you have any questions about this Privacy Policy, please contact us at privacy@delphi.finance.
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
