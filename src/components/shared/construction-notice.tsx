import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Construction } from "lucide-react"

export function ConstructionNotice({ title, description }: { title: string, description: string }) {
    return (
        <Card className="bg-white/5 border-white/10 border-dashed backdrop-blur-md">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-muted-foreground">
                    <Construction className="h-5 w-5" />
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{description}</p>
                <p className="text-xs text-muted-foreground mt-4 opacity-50">This module is currently in development for Phase 4.</p>
            </CardContent>
        </Card>
    )
}
