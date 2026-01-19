export const SOLUTIONS_DATA: Record<string, { title: string; subtitle: string; description: string; features: string[] }> = {
    'coffee-shop': {
        title: "The Ultimate OS for Coffee Shops",
        subtitle: "Manage beans, brews, and baristas in one place.",
        description: "Stop juggling spreadsheets. Delphi gives high-volume cafes the inventory tracking, shift management, and customer loyalty tools they need to scale.",
        features: ["Ingredient-level Inventory (Beans/Milk)", "Barista Shift Scheduling", "Customer Loyalty & Punch Cards", "High-Speed POV for Rush Hour"]
    },
    'retail-store': {
        title: "Modern POS for Boutique Retail",
        subtitle: "Inventory, e-commerce, and instore sales synced.",
        description: "Whether you sell clothes, gifts, or gadgets, Delphi unifies your online and offline worlds. Get real-time stock alerts and automated reordering.",
        features: ["Shopify & WooCommerce Sync", "Barcode Scanning & Label Printing", "CRM & Customer Hstory", "Multi-Location Inventory"]
    },
    'consulting-firm': {
        title: "Financial Clarity for Consultants",
        subtitle: "Project billing, time tracking, and expense management.",
        description: "Focus on your clients, not your books. Delphi automates invoicing, tracks billable hours, and categorizes expenses for tax season automatically.",
        features: ["Automated Invoicing & Reminders", "Project-based Profitability", "Expense Receipt Scanning", "Contractor Payouts"]
    },
    'restaurant': {
        title: "Restaurant Management Simplified",
        subtitle: "Front of house, back of house, and everything in between.",
        description: "From table management to kitchen display systems, Delphi powers the modern restaurant. Reduce food waste and increase table turnover.",
        features: ["Table Management & Reservations", "Kitchen Display System (KDS)", "Recipe Costing & Menu Engineering", "Staff Tip Pooling"]
    }
}

export const GENERIC_DATA = (industry: string) => ({
    title: `Business Management for ${industry.replace('-', ' ')}`,
    subtitle: "All-in-one finance, operations, and team management.",
    description: `Streamline your ${industry.replace('-', ' ')} business with Delphi. Track revenue, manage team schedules, and automate tax compliance in one dashboard.`,
    features: ["Unified Financial Dashboard", "Team Roles & Permissions", "Automated Tax Estimates", "Growth Analytics"]
})
