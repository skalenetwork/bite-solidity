// POST /api/deposit — deposit gas tokens into the contract for a user
import { NextRequest, NextResponse } from "next/server";
import { depositForUser } from "@/lib/service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const userId = body.userId as number;
        const amount = body.amount as string;

        if (userId !== 1 && userId !== 2) {
            return NextResponse.json({ error: "userId must be 1 or 2" }, { status: 400 });
        }

        if (!amount || !/^\d+$/.test(amount)) {
            return NextResponse.json({ error: "amount must be a positive integer string (wei)" }, { status: 400 });
        }

        const txHash = await depositForUser(userId as 1 | 2, amount);
        return NextResponse.json({ txHash });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
