// POST /api/withdraw — withdraw all deposited funds for a user
import { NextRequest, NextResponse } from "next/server";
import { withdrawForUser } from "@/lib/service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const userId = body.userId as number;

        if (userId !== 1 && userId !== 2) {
            return NextResponse.json({ error: "userId must be 1 or 2" }, { status: 400 });
        }

        const txHash = await withdrawForUser(userId as 1 | 2);
        return NextResponse.json({ txHash });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
