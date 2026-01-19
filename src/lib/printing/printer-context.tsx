"use client"

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react'

// WebUSB Types (Basic polyfill for TS)
interface USBDevice {
    open(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
    close(): Promise<void>;
    productName?: string;
    vendorId: number;
    productId: number;
}

interface USBOutTransferResult {
    bytesWritten: number;
    status: 'ok' | 'stall' | 'babble';
}

interface NavigatorWithUSB extends Navigator {
    usb: {
        requestDevice(options: { filters: any[] }): Promise<USBDevice>;
        getDevices(): Promise<USBDevice[]>;
    }
}

interface PrinterContextType {
    device: USBDevice | null;
    isConnecting: boolean;
    error: string | null;
    connectPrinter: () => Promise<void>;
    disconnectPrinter: () => Promise<void>;
    printData: (data: Uint8Array) => Promise<void>;
}

const PrinterContext = createContext<PrinterContextType | undefined>(undefined)

export function PrinterProvider({ children }: { children: ReactNode }) {
    const [device, setDevice] = useState<USBDevice | null>(null)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const connectPrinter = async () => {
        setIsConnecting(true)
        setError(null)
        try {
            const nav = navigator as unknown as NavigatorWithUSB;
            if (!nav.usb) {
                throw new Error("WebUSB not supported in this browser");
            }

            // Request permission to access a USB device
            // Filter for standard printer class (7)
            const selectedDevice = await nav.usb.requestDevice({
                filters: [] // Empty filters allows selecting any device (user choice)
            });

            await selectedDevice.open();
            // Typically configuration 1 is standard
            await selectedDevice.selectConfiguration(1);
            // Claim interface 0 (standard for simple bulk devices)
            await selectedDevice.claimInterface(0);

            setDevice(selectedDevice);
            console.log("Printer connected:", selectedDevice.productName);

        } catch (err: any) {
            console.error("Printer connection failed:", err);
            setError(err.message || "Failed to connect to printer");
        } finally {
            setIsConnecting(false)
        }
    }

    const disconnectPrinter = async () => {
        if (device) {
            try {
                await device.close();
            } catch (err) {
                console.error("Error closing printer:", err);
            }
            setDevice(null);
        }
    }

    const printData = async (data: Uint8Array) => {
        if (!device) {
            setError("No printer connected");
            return;
        }

        try {
            // Endpoint 2 or 1 is commonly OUT for printers. 
            // We might need to discover this, but 0x02 (endpoint 2) is a safe common default for bulk out.
            // Or we could inspect 'device.configuration.interfaces[0].alternate.endpoints'
            // For this MVP, let's try endpoint 1, then fallback/error. 
            // Better: loop endpoints to find 'out' direction.
            // Simplified: Try endpoint 1.

            // Note: In a real robust driver, we'd inspect the interface.
            // Assuming endpoint 1 for out.
            await device.transferOut(1, data as any);

        } catch (err: any) {
            console.error("Print failed:", err);
            setError("Failed to send data to printer: " + err.message);
        }
    }

    return (
        <PrinterContext.Provider value={{
            device,
            isConnecting,
            error,
            connectPrinter,
            disconnectPrinter,
            printData
        }}>
            {children}
        </PrinterContext.Provider>
    )
}

export function usePrinter() {
    const context = useContext(PrinterContext)
    if (context === undefined) {
        throw new Error('usePrinter must be used within a PrinterProvider')
    }
    return context
}
