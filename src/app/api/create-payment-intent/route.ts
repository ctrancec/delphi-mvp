import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-12-15.clover' as any, // Type assertion for newer API version
    })
    : null;

export async function POST(req: Request) {
    if (!stripe) {
        return NextResponse.json(
            { error: 'Stripe is not configured (Missing STRIPE_SECRET_KEY)' },
            { status: 500 }
        );
    }
    try {
        const { amount } = await req.json()

        if (!amount) {
            return NextResponse.json({ error: 'Amount is required' }, { status: 400 })
        }

        // Create PaymentIntent
        // Amount should be in cents (e.g., $10.00 = 1000)
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert dollars to cents
            currency: 'usd',
            automatic_payment_methods: {
                enabled: true,
            },
        })

        return NextResponse.json({ clientSecret: paymentIntent.client_secret })
    } catch (error: any) {
        console.error("Stripe Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
