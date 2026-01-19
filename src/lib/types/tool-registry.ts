import {
    LayoutDashboard,
    CreditCard,
    Newspaper,
    PieChart,
    FileText,
    Users,
    Receipt,
    Store,
    Package,
    Calendar,
    Briefcase,
    UtensilsCrossed,
    Menu,
    Clock,
    DollarSign,
    Box,
    Truck,
    Shield
} from 'lucide-react'

export type ToolId =
    | 'overview'
    | 'transactions'
    // | 'news'
    | 'analytics'
    | 'invoices'
    // | 'delivery'
    | 'vendor_analysis'
    | 'team'
    | 'expenses'
    | 'taxes'
    | 'pos'
    | 'orders'
    | 'inventory'
    | 'shifts'
    | 'menu'
    | 'kitchen'
    | 'jobs'
    | 'time_tracking'
    | 'accounts'
    // | 'net_worth'
    | 'budget'
    | 'subscription_admin'
    | 'consolidated_reports';

export type UserRole = 'owner' | 'manager' | 'staff' | 'chef'

export interface ToolDefinition {
    id: ToolId;
    label: string;
    icon: any;
    href: string;
    description: string;
    tier: 'free' | 'pro' | 'business' | 'enterprise';
    allowedRoles?: UserRole[]; // If undefined, allowed for all roles except limited ones
}

export const TOOL_REGISTRY: Record<ToolId, ToolDefinition> = {
    // Core (Free)
    overview: { id: 'overview', label: 'Overview', icon: LayoutDashboard, href: '/dashboard', description: 'Main dashboard view.', tier: 'free' },
    transactions: { id: 'transactions', label: 'Transactions', icon: CreditCard, href: '/dashboard/transactions', description: 'View and manage transactions.', tier: 'free' },

    // Personal Pro
    // news: { id: 'news', label: 'News Feed', icon: Newspaper, href: '/dashboard/news', description: 'Financial news and updates.', tier: 'pro', allowedRoles: ['owner', 'manager'] },
    budget: { id: 'budget', label: 'Budgeting', icon: PieChart, href: '/dashboard/budget', description: 'Set and track budgets.', tier: 'pro', allowedRoles: ['owner', 'manager'] },
    analytics: { id: 'analytics', label: 'Analytics', icon: PieChart, href: '/dashboard/analytics', description: 'Deep dive into financial data.', tier: 'pro', allowedRoles: ['owner', 'manager'] },
    accounts: { id: 'accounts', label: 'Accounts', icon: CreditCard, href: '/dashboard/accounts', description: 'Manage bank accounts and cards.', tier: 'free', allowedRoles: ['owner', 'manager'] },
    // net_worth: { id: 'net_worth', label: 'Net Worth', icon: DollarSign, href: '/dashboard/net-worth', description: 'Track assets and liabilities.', tier: 'pro', allowedRoles: ['owner'] },

    // Business
    invoices: { id: 'invoices', label: 'Invoices', icon: FileText, href: '/dashboard/invoices', description: 'Create and send invoices.', tier: 'business', allowedRoles: ['owner', 'manager'] },
    vendor_analysis: { id: 'vendor_analysis', label: 'Vendor Analysis', icon: Users, href: '/dashboard/vendors', description: 'Track vendor spend and performance.', tier: 'business', allowedRoles: ['owner', 'manager'] },
    team: { id: 'team', label: 'Team', icon: Users, href: '/dashboard/team', description: 'Manage staff and roles.', tier: 'business', allowedRoles: ['owner', 'manager'] },
    expenses: { id: 'expenses', label: 'Expenses', icon: Receipt, href: '/dashboard/expenses', description: 'Track business expenses.', tier: 'business', allowedRoles: ['owner', 'manager'] },
    taxes: { id: 'taxes', label: 'Taxes', icon: FileText, href: '/dashboard/taxes', description: 'Tax preparation and estimation.', tier: 'business', allowedRoles: ['owner'] },
    // delivery: { id: 'delivery', label: 'Delivery Hub', icon: Truck, href: '/dashboard/delivery', description: 'Manage UberEats & DoorDash.', tier: 'business', allowedRoles: ['owner', 'manager', 'staff'] },

    // Retail / Restaurant Specific
    pos: { id: 'pos', label: 'Point of Sale', icon: Store, href: '/dashboard/pos', description: 'Process sales and orders.', tier: 'business', allowedRoles: ['owner', 'manager', 'staff'] },
    orders: { id: 'orders', label: 'Order History', icon: Receipt, href: '/dashboard/orders', description: 'View past orders and receipts.', tier: 'business' },
    inventory: { id: 'inventory', label: 'Inventory', icon: Package, href: '/dashboard/inventory', description: 'Track stock levels.', tier: 'business', allowedRoles: ['owner', 'manager', 'chef'] },
    shifts: { id: 'shifts', label: 'Staff Shifts', icon: Calendar, href: '/dashboard/shifts', description: 'Schedule and manage shifts.', tier: 'business', allowedRoles: ['owner', 'manager', 'staff'] },
    menu: { id: 'menu', label: 'Menu Mgmt', icon: Menu, href: '/dashboard/menu', description: 'Manage products and menu items.', tier: 'business', allowedRoles: ['owner', 'manager', 'chef'] },
    kitchen: { id: 'kitchen', label: 'Kitchen Display', icon: UtensilsCrossed, href: '/dashboard/kitchen', description: 'KDS for back of house.', tier: 'business', allowedRoles: ['owner', 'manager', 'chef', 'staff'] },

    // Freelance Specific
    jobs: { id: 'jobs', label: 'Recent Jobs', icon: Briefcase, href: '/dashboard/jobs', description: 'Track active freelance jobs.', tier: 'business' },
    time_tracking: { id: 'time_tracking', label: 'Time Tracking', icon: Clock, href: '/dashboard/time', description: 'Track billable hours.', tier: 'business' },

    // Admin Tools
    subscription_admin: { id: 'subscription_admin', label: 'Sub Admin', icon: Shield, href: '/dashboard/admin/subscriptions', description: 'Manage workspace tiers.', tier: 'business', allowedRoles: ['owner'] },

    // Reports
    consolidated_reports: { id: 'consolidated_reports', label: 'Holdings', icon: PieChart, href: '/dashboard/reports/consolidated', description: 'Multi-entity financial report.', tier: 'enterprise', allowedRoles: ['owner'] },
};
