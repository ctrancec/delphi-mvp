import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Plus, Clock, CheckCircle2, MoreHorizontal, User } from 'lucide-react'

export default async function ProjectsPage() {
    const supabase = await createClient()

    let user = null;

    if (supabase) {
        const { data } = await supabase.auth.getUser()
        user = data.user
    } else {
        user = { email: 'demo@delphi.com', id: 'mock-user-id' } as any
    }

    if (!user) {
        redirect('/login')
    }

    const projects = [
        { id: 1, name: "Website Redesign", client: "Acme Corp", progress: 75, status: "In Progress", due: "2 days left" },
        { id: 2, name: "Mobile App API", client: "Globex Inc", progress: 30, status: "On Hold", due: "2 weeks left" },
        { id: 3, name: "SEO Audit", client: "Soylent Corp", progress: 100, status: "Completed", due: "Done" },
        { id: 4, name: "Data Migration", client: "Umbrella Corp", progress: 10, status: "In Progress", due: "1 month left" },
    ]

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Projects</h2>
                    <p className="text-muted-foreground">
                        Manage client deliverables and track progress.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Plus className="h-4 w-4" />
                        New Project
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {projects.map(project => (
                    <Card key={project.id} className="bg-white/5 border-white/10 backdrop-blur-md hover:bg-white/10 transition-colors cursor-pointer group">
                        <CardHeader className="flex flex-row items-start justify-between pb-2">
                            <div>
                                <CardTitle className="text-lg font-bold text-white group-hover:text-primary transition-colors">
                                    {project.name}
                                </CardTitle>
                                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                    <User className="h-3 w-3" />
                                    {project.client}
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between text-sm">
                                <Badge variant="secondary" className={
                                    project.status === 'Completed' ? "bg-emerald-500/10 text-emerald-500" :
                                        project.status === 'In Progress' ? "bg-blue-500/10 text-blue-500" :
                                            "bg-yellow-500/10 text-yellow-500"
                                }>
                                    {project.status}
                                </Badge>
                                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                                    <Clock className="h-3 w-3" />
                                    {project.due}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Progress</span>
                                    <span>{project.progress}%</span>
                                </div>
                                <Progress value={project.progress} className={
                                    project.status === 'Completed' ? "[&>div]:bg-emerald-500" :
                                        "bg-white/10"
                                } />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
