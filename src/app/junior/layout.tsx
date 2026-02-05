import { Inter } from "next/font/google"; // Use Inter or maybe a more playful font if available, sticking to Inter for now
import { Rocket } from "lucide-react";

export default function JuniorLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-indigo-950 text-white selection:bg-yellow-400 selection:text-indigo-900 font-sans">
            {/* Junior Navbar */}
            <header className="fixed top-0 left-0 right-0 z-50 h-20 bg-indigo-900/80 backdrop-blur-md border-b border-indigo-500/30 flex items-center justify-between px-6 shadow-xl">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-yellow-400 flex items-center justify-center text-indigo-900 shadow-lg shadow-yellow-400/20">
                        <Rocket className="h-7 w-7" />
                    </div>
                    <span className="text-2xl font-black tracking-tight text-white drop-shadow-sm">
                        Delphi Junior
                    </span>
                </div>
                {/* We can put a simple clock or avatar here later */}
            </header>

            <main className="pt-24 min-h-screen p-4 md:p-8 relative overflow-hidden">
                {/* Background Elements */}
                <div className="fixed inset-0 pointer-events-none z-0">
                    <div className="absolute top-20 left-10 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
                    <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
                </div>

                <div className="relative z-10 max-w-6xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
