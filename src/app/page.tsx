import Link from "next/link"
import { ArrowRight, BarChart3, Globe, Lock, ShieldCheck, Zap, Check, LayoutDashboard, PieChart, Users, Fingerprint, Triangle } from "lucide-react"

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      {/* Navbar */}
      <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
              {/* Delta (Triangle) for Delphi */}
              <Triangle className="h-5 w-5 fill-current" />
            </div>
            <span className="text-lg font-bold tracking-tight">Delphi</span>
          </div>
          <nav className="hidden gap-8 md:flex">
            <Link className="text-sm font-medium hover:text-primary transition-colors" href="#features">
              Features
            </Link>
            <Link className="text-sm font-medium hover:text-primary transition-colors" href="#pricing">
              Pricing
            </Link>
            <Link className="text-sm font-medium hover:text-primary transition-colors" href="#security">
              Security
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              className="text-sm font-medium hover:text-primary transition-colors"
              href="/login"
            >
              Log In
            </Link>
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md bg-white text-black px-4 py-2 text-sm font-medium shadow hover:bg-gray-200 transition-colors"
              href="/login?mode=signup"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative h-screen min-h-[800px] flex items-center justify-center overflow-hidden bg-zinc-950">
          {/* Cinematic Background Image */}
          <div className="absolute inset-0 z-0 bg-zinc-950">
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
            <div className="absolute inset-0 bg-black/60 z-10" />
            {/* Cinematic Skyscraper (Original) */}
            <img
              src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2670&auto=format&fit=crop"
              alt="Cinematic Skyscraper"
              className="w-full h-full object-cover opacity-60"
            />
          </div>

          <div className="container mx-auto relative z-10 px-4 md:px-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-primary mb-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              The Oracle is Online
            </div>

            <h1 className="mx-auto max-w-4xl text-5xl font-extrabold tracking-tight sm:text-7xl mb-6 text-white drop-shadow-md animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-100">
              The Oracle of Wealth.
            </h1>

            <p className="mx-auto max-w-2xl text-xl text-gray-200 mb-10 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
              Unified financial intelligence. Track personal assets, business cash flow, and market movements in one elevated interface.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
              <Link
                href="/login?mode=signup"
                className="inline-flex h-12 items-center justify-center rounded-lg bg-primary px-8 text-sm font-medium text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 hover:scale-105"
              >
                Enter the Vault
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="#demo"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-8 text-sm font-medium text-white backdrop-blur-sm transition-all hover:bg-white/10 hover:border-white/20"
              >
                View Live Demo
              </Link>
            </div>
          </div>

          {/* Floating Cards (Visual Mockup) */}
          <div className="mt-20 container mx-auto px-4 md:px-6 relative h-[400px] w-full max-w-5xl mx-auto perspective-1000">
            {/* Main Dashboard Card */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-full max-w-3xl glass-panel rounded-xl p-6 border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-1000 delay-500 transform rotate-x-6 hover:rotate-x-0 transition-transform duration-700">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <p className="text-sm text-muted-foreground">Total Net Worth</p>
                  <h3 className="text-4xl font-bold text-white tracking-tight">$1,245,678.00</h3>
                </div>
                <div className="flex gap-2">
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-xs font-medium border border-emerald-500/20">
                    +2.4%
                  </span>
                </div>
              </div>
              <div className="h-[200px] w-full bg-gradient-to-r from-primary/5 to-transparent rounded-lg border border-white/5 relative overflow-hidden">
                {/* Fake Chart Line */}
                <svg className="absolute bottom-0 left-0 w-full h-[120px]" preserveAspectRatio="none" viewBox="0 0 100 20">
                  <path d="M0 20 L0 15 Q10 10 20 12 T40 10 T60 14 T80 5 L100 2 L100 20 Z" fill="url(#gradient)" opacity="0.4" />
                  <path d="M0 15 Q10 10 20 12 T40 10 T60 14 T80 5 L100 2" stroke="currentColor" strokeWidth="0.5" fill="none" className="text-primary" />
                  <defs>
                    <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" />
                      <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute top-4 left-4 flex gap-2">
                  <div className="h-2 w-12 bg-white/10 rounded-full" />
                  <div className="h-2 w-8 bg-white/5 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Expanded Features Section */}
        <section id="features" className="container mx-auto px-4 md:px-6 py-24 relative space-y-32">


          {/* Feature 0: Personal Wealth Command */}
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-32">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 mb-6">
                <PieChart className="h-3 w-3" />
                Personal Command Center
              </div>
              <h3 className="text-3xl font-bold mb-4 tracking-tight">Master your finances.</h3>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                Connect your bank accounts and visualize your financial health in real-time. No more spreadsheets.
              </p>
              <ul className="space-y-3">
                {[
                  "Unified Account View",
                  "Smart Budgeting & Categorization",
                  "Expense Analytics",
                  "AI Receipt Scanning"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500"><Check className="h-3 w-3" /></div>
                    <span className="text-sm font-medium">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full pointer-events-none" />
              <div className="glass-panel p-2 rounded-2xl border border-white/10 relative overflow-hidden group hover:-translate-y-2 transition-transform duration-500 max-w-lg mx-auto">
                <img
                  src="/images/personal_wealth.png"
                  alt="Personal Wealth Dashboard"
                  className="w-full rounded-xl"
                />
                {/* Overlay Badge */}
                <div className="absolute top-4 right-4 glass-panel px-3 py-1 rounded-full text-xs font-bold text-white flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Live Sync Active
                </div>
              </div>
            </div>
          </div>

          {/* Feature 1: Modular Intelligence */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="absolute inset-0 bg-blue-500/20 blur-[80px] rounded-full pointer-events-none" />
              <div className="glass-panel p-2 rounded-2xl border border-white/10 relative overflow-hidden group max-w-lg mx-auto">
                <img
                  src="/images/adaptive_workspaces.png"
                  alt="Modular Dashboard"
                  className="w-full rounded-xl transition-transform duration-700 group-hover:scale-105"
                />
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6">
                <LayoutDashboard className="h-3 w-3" />
                Modular Intelligence
              </div>
              <h3 className="text-3xl font-bold mb-4 tracking-tight">Your Workspace, Your Rules.</h3>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                Delphi isn't a rigid template. It's a collection of powerful tools. <strong>Toggle features on and off</strong> to build the exact system you need.
              </p>
              <ul className="space-y-3">
                {[
                  "Enable 'POS' for your pop-up shop",
                  "Turn on 'Invoicing' for freelance work",
                  "Hide everything but 'Analytics' for focus"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Check className="h-3 w-3" /></div>
                    <span className="text-sm font-medium">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Feature 2: Restaurant POS (Renamed from Delivery) */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-400 mb-6">
                <Zap className="h-3 w-3" />
                Cloud Point of Sale
              </div>
              <h3 className="text-3xl font-bold mb-4 tracking-tight">Modern Retail & Dining.</h3>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                Stop juggling clunky hardware. Delphi's <strong>Cloud POS</strong> runs on any tablet, connects seamlessly to your kitchen display, and manages inventory in real-time.
              </p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-purple-500/20 blur-[80px] rounded-full pointer-events-none" />
              <div className="relative grid gap-4 max-w-lg mx-auto">
                <div className="glass-panel p-2 rounded-2xl border border-white/10 relative overflow-hidden transform hover:-translate-y-2 transition-transform duration-500 z-10">
                  <img
                    src="/images/pos_tablet.png"
                    alt="Cloud POS Interface"
                    className="w-full rounded-xl"
                  />
                </div>
                {/* Delivery Hub Hidden
                <div className="glass-panel p-2 rounded-2xl border border-white/10 relative overflow-hidden transform translate-x-12 -mt-12 opacity-90 hover:opacity-100 hover:translate-x-0 transition-all duration-500">
                  <img
                    src="/images/delivery_hub.png"
                    alt="Delivery Hub KDS"
                    className="w-full rounded-xl"
                  />
                </div>
                */}
              </div>
            </div>
          </div>

        </section>


        {/* Security Section */}
        <section id="security" className="py-24 border-y border-white/5 bg-white/[0.02]">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6 mx-auto lg:mx-0">
                  <Lock className="h-3 w-3" />
                  Security First Architecture
                </div>
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl mb-6">Your data is secured by industry standards.</h2>
                <ul className="space-y-4">
                  {[
                    "AES-256 Encryption at rest & transit",
                    "Row Level Security (RLS) ensures data isolation",
                    "Multi-Factor Authentication ready",
                    "Privacy-First Architecture"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0 text-green-500">
                        <Check className="h-3 w-3" />
                      </div>
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-blue-500/20 blur-3xl opacity-30" />
                <div className="glass-panel rounded-xl p-0 border border-white/10 relative overflow-hidden h-[300px] group bg-zinc-900">
                  {/* Background Image: Abstract Digital Grid (Neutral/Secure) */}
                  <img
                    src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop"
                    alt="Global Data Security"
                    className="absolute inset-0 w-full h-full object-cover opacity-40 transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-black/50 to-transparent" />

                  {/* Live Status HUD */}
                  <div className="absolute bottom-6 left-6 right-6">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-mono text-cyan-400 flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                        SYSTEM_SECURE
                      </span>
                      {/* Lock Icon - Represents Encryption/Storage */}
                      <Lock className="h-8 w-8 text-white/80" />
                    </div>
                    <div className="space-y-1">
                      <div className="h-0.5 w-full bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-400 w-full shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                        <span>AES-256 Encrypted</span>
                        <span>RLS Enabled</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="container mx-auto px-4 md:px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Choose the intelligence level that fits your needs.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {/* Free */}
            <div className="glass-card p-6 rounded-2xl border border-white/10 flex flex-col items-center text-center relative opacity-90 hover:opacity-100 transition-opacity">
              <h3 className="text-xl font-bold mb-2">Free</h3>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <p className="text-muted-foreground mb-8 text-sm">For students and beginners.</p>
              <ul className="space-y-3 mb-8 w-full">
                {["Manual Transactions", "Unlimited Accounts", "Basic Overview", "7-Day History"].map((feat) => (
                  <li key={feat} className="flex items-center justify-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link href="/login?mode=signup&plan=free" className="w-full py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-center text-sm font-medium transition-colors">
                Get Started
              </Link>
            </div>

            {/* Personal Pro */}
            <div className="glass-card p-8 rounded-2xl border border-primary/50 bg-primary/5 flex flex-col items-center text-center relative shadow-2xl shadow-primary/10 overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary text-white text-xs font-bold px-3 py-1 rounded-bl-xl">POPULAR</div>
              <h3 className="text-xl font-bold mb-2">Personal Pro</h3>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">$12</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <div className="inline-block bg-white/10 rounded-full px-3 py-1 text-xs text-white font-medium mb-6">
                Includes Budgeting
              </div>
              <p className="text-muted-foreground mb-8 text-sm">For individuals and families mastering their wealth.</p>
              <ul className="space-y-3 mb-8 w-full">
                {["Unified Account View", "Smart Budgeting", "Advanced Analytics", "Priority Support"].map((feat) => (
                  <li key={feat} className="flex items-center justify-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link href="/login?mode=signup&plan=personal" className="w-full py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-center text-sm font-medium transition-colors">
                Start Free Trial
              </Link>
            </div>

            {/* Business */}
            <div className="glass-card p-6 rounded-2xl border border-white/10 flex flex-col items-center text-center relative">
              <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl">NEW</div>
              <h3 className="text-xl font-bold mb-2">Business</h3>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-primary">$49</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <p className="text-muted-foreground mb-8 text-sm">For Restaurants, Retail, and Service Pros.</p>
              <ul className="space-y-3 mb-8 w-full">
                {["Access to ALL Tools", "POS, Invoicing, Inventory", "Team Management", "Tax Exports"].map((feat) => (
                  <li key={feat} className="flex items-center justify-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-white" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link href="/login?mode=signup&plan=business" className="w-full py-3 rounded-lg bg-primary hover:bg-primary/90 text-white text-center text-sm font-medium transition-colors shadow-lg shadow-primary/25">
                Get Started
              </Link>
            </div>

            {/* Enterprise */}
            <div className="glass-card p-8 rounded-2xl border border-white/10 flex flex-col items-center text-center relative opacity-80 hover:opacity-100 transition-opacity">
              <div className="absolute top-0 right-0 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl">IN DEVELOPMENT</div>
              <h3 className="text-xl font-bold mb-2">Enterprise</h3>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold">Custom</span>
              </div>
              <p className="text-muted-foreground mb-8 text-sm">For scaling companies requiring maximum control.</p>
              <ul className="space-y-3 mb-8 w-full">
                {["Unlimited Team Members", "Role-Based Access (RBAC)", "Audit Logs", "Dedicated Support"].map((feat) => (
                  <li key={feat} className="flex items-center justify-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link href="mailto:sales@delphi.finance" className="w-full py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-center text-sm font-medium transition-colors">
                Contact Sales
              </Link>
            </div>
          </div>
        </section >

        {/* CTA */}
        <section className="py-24 bg-gradient-to-b from-transparent to-primary/10">
          <div className="container mx-auto px-4 md:px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-5xl mb-6">Ready to see the future?</h2>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login?mode=signup"
                className="inline-flex h-12 items-center justify-center rounded-lg bg-white text-black px-8 text-sm font-bold shadow-lg hover:bg-gray-200 transition-all hover:scale-105"
              >
                Start Your 14-Day Free Trial
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">No credit card required for demo.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-background py-12">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-primary cursor-pointer"><Link href="#features">Features</Link></li>
                <li className="hover:text-primary cursor-pointer"><Link href="#pricing">Pricing</Link></li>
                <li className="hover:text-primary cursor-pointer">Roadmap <span className="text-[10px] bg-primary/20 text-primary px-1 rounded ml-1">Soon</span></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-primary cursor-pointer">About</li>
                <li className="hover:text-primary cursor-pointer">Blog</li>
                <li className="hover:text-primary cursor-pointer">Careers</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-primary cursor-pointer">Documentation</li>
                <li className="hover:text-primary cursor-pointer">Help Center</li>
                <li className="hover:text-primary cursor-pointer"><Link href="#security">Security</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-primary cursor-pointer"><Link href="/legal/privacy">Privacy Policy</Link></li>
                <li className="hover:text-primary cursor-pointer"><Link href="/legal/terms">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="flex justify-between items-center pt-8 border-t border-white/5">
            <p className="text-muted-foreground text-sm">© 2026 Delphi Finance.</p>
            <div className="flex gap-4">
              <Globe className="h-4 w-4 text-muted-foreground hover:text-white cursor-pointer" />
            </div>
          </div>
        </div>
      </footer>
    </div >
  )
}
