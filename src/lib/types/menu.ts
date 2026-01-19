
export type MenuItemStatus = 'active' | 'archived' | 'out_of_stock';

export interface ModifierOption {
    id: string;
    name: string;
    priceDelta: number; // Extra cost, e.g. +$1
    isDefault?: boolean;
}

export interface ModifierGroup {
    id: string;
    name: string; // e.g. "Milk Choice"
    minSelection: number; // 1 = required
    maxSelection: number; // 1 = single choice
    options: ModifierOption[];
}

export interface UnifiedMenuItem {
    id: string;
    name: string;
    description?: string;
    price: number;
    category: string;
    image?: string; // Emoji or URL
    stock: number;
    status: MenuItemStatus;

    // Advanced features for Delivery/POS
    variants?: ModifierGroup[]; // e.g. Size (Small, Med, Large)
    modifiers?: ModifierGroup[]; // e.g. Toppings, Milk

    // Integrations
    externalIds?: {
        uberEats?: string;
        doorDash?: string;
        square?: string;
    };
}
