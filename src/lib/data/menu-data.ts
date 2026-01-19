import { UnifiedMenuItem } from '../types/menu';

export const MENU_CATEGORIES = ["Beverages", "Food", "Merch", "Retail"];

export const INITIAL_MENU_DATA: UnifiedMenuItem[] = [
    {
        id: "1",
        name: "Organic Espresso",
        price: 4.50,
        category: "Beverages",
        image: "☕",
        stock: 120,
        status: "active",
        description: "Double shot of single-origin espresso"
    },
    {
        id: "2",
        name: "Avocado Toast",
        price: 12.00,
        category: "Food",
        image: "🥑",
        stock: 45,
        status: "active",
        modifiers: [
            {
                id: "mg_toppings",
                name: "Add On",
                minSelection: 0,
                maxSelection: 3,
                options: [
                    { id: "opt_egg", name: "Poached Egg", priceDelta: 2.00 },
                    { id: "opt_bacon", name: "Bacon", priceDelta: 3.00 }
                ]
            }
        ]
    },
    {
        id: "3",
        name: "Matcha Latte",
        price: 5.50,
        category: "Beverages",
        image: "🍵",
        stock: 85,
        status: "active"
    },
    {
        id: "4",
        name: "Blueberry Muffin",
        price: 3.75,
        category: "Food",
        image: "🫐",
        stock: 12,
        status: "active" // This is a check. If it fails, I will write new file.
    },
    {
        id: "5",
        name: "Iced Coffee",
        price: 4.00,
        category: "Beverages",
        image: "🧊",
        stock: 200,
        status: "active"
    },
    {
        id: "6",
        name: "Croissant",
        price: 3.50,
        category: "Food",
        image: "🥐",
        stock: 8,
        status: "active"
    },
    {
        id: "7",
        name: "Green Tea",
        price: 3.00,
        category: "Beverages",
        image: "🫖",
        stock: 50,
        status: "active"
    },
    {
        id: "8",
        name: "Bagel & Lox",
        price: 14.00,
        category: "Food",
        image: "🥯",
        stock: 20,
        status: "active"
    },
    {
        id: "9",
        name: "Smoothie Bowl",
        price: 11.00,
        category: "Food",
        image: "🥣",
        stock: 15,
        status: "active"
    },
    {
        id: "10",
        name: "Cappuccino",
        price: 4.75,
        category: "Beverages",
        image: "☕",
        stock: 90,
        status: "active"
    },
    {
        id: "11",
        name: "Winter Special Blend",
        price: 18.00,
        category: "Retail",
        image: "🛍️",
        stock: 0,
        status: "out_of_stock"
    }
];

export function getLowStockItems(items: UnifiedMenuItem[]) {
    return items.filter(i => i.stock < 15 && i.stock > 0);
}
