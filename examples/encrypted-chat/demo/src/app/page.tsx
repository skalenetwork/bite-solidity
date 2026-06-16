"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types mirroring API responses ──

type UserState = {
    address: string;
    balance: string;
    deposit: string;
    isRegistered: boolean;
};

type DashboardState = {
    user1: UserState;
    user2: UserState;
    sessionExists: boolean;
    contractAddress: string;
};

type ChatMessage = {
    timestamp: number;
    sender: string;
    encryptedContent: string;
};

// ── Helpers ──

const formatCredits = (wei: string): string => {
    const n = Number(wei) / 1e18;
    return n.toFixed(4);
};

const formatTime = (ts: number): string => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const truncateAddr = (addr: string): string =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

/** Stable key for a message — timestamp + sender is unique enough */
const msgKey = (m: ChatMessage): string => `${m.timestamp}-${m.sender}`;

// ── API helpers ──

async function api<T>(url: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as T;
}

const fetchState = () => api<DashboardState>("/api/state");
const fetchMessages = (offset: number, amount: number) =>
    api<{ messages: ChatMessage[]; total: number }>(`/api/messages?offset=${offset}&amount=${amount}`);
const postRegister = (userId: 1 | 2) =>
    api<{ txHash: string }>("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
    });
const postSession = () =>
    api<{ txHash: string }>("/api/session", { method: "POST" });
const postSend = (userId: 1 | 2, message: string) =>
    api<{ txHash: string }>("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message }),
    });
const postDeposit = (userId: 1 | 2, amount: string) =>
    api<{ txHash: string }>("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount }),
    });
const postWithdraw = (userId: 1 | 2) =>
    api<{ txHash: string }>("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
    });
const postTransfer = (userId: 1 | 2, amount: string) =>
    api<{ txHash: string }>("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount }),
    });
const fetchSessionKey = (userId: 1 | 2) =>
    api<{ sessionKey: string }>(`/api/session-key?userId=${userId}`);
const postDecrypt = (encryptedContent: string, sessionKey: string) =>
    api<{ plaintext: string }>("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedContent, sessionKey }),
    });

// ── Confirmation dialog state ──

type PendingAction = {
    title: string;
    description: string;
    onConfirm: () => Promise<unknown>;
};

// ── Component ──

export default function ChatPage() {
    const [state, setState] = useState<DashboardState | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [totalMsgs, setTotalMsgs] = useState(0);
    const [input1, setInput1] = useState("");
    const [input2, setInput2] = useState("");
    const [transferAmt1, setTransferAmt1] = useState("");
    const [transferAmt2, setTransferAmt2] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [sessionKey, setSessionKey] = useState<string | null>(null);
    const [decryptedTexts, setDecryptedTexts] = useState<Record<string, string>>({});
    const [showDecrypted, setShowDecrypted] = useState<Record<string, boolean>>({});
    const [decrypting, setDecrypting] = useState<Record<string, boolean>>({});
    const msgEnd1 = useRef<HTMLDivElement>(null);
    const msgEnd2 = useRef<HTMLDivElement>(null);

    // ── Error auto-dismiss ──
    useEffect(() => {
        if (!error) return;
        const t = setTimeout(() => setError(null), 5000);
        return () => clearTimeout(t);
    }, [error]);

    // ── Refresh dashboard state ──
    const refreshState = useCallback(async () => {
        try {
            const s = await fetchState();
            setState(s);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch state");
        }
    }, []);

    // ── Poll messages ──
    const pollMessages = useCallback(async () => {
        if (!state?.sessionExists) return;
        try {
            const { messages: batch, total } = await fetchMessages(0, 100);
            // If there are more messages, page through
            let all = [...batch];
            let offset = batch.length;
            while (offset < total) {
                const page = await fetchMessages(offset, 100);
                all = [...all, ...page.messages];
                offset += page.messages.length;
                if (page.messages.length === 0) break;
            }
            setMessages(all);
            setTotalMsgs(total);
        } catch {
            // Silently ignore polling errors — will retry next interval
        }
    }, [state?.sessionExists]);

    // ── Initial load + state poll ──
    useEffect(() => {
        refreshState();
        const interval = setInterval(refreshState, 3000);
        return () => clearInterval(interval);
    }, [refreshState]);

    // ── Fetch session key once session exists ──
    useEffect(() => {
        if (!state?.sessionExists || sessionKey) return;
        fetchSessionKey(1)
            .then(({ sessionKey: key }) => setSessionKey(key))
            .catch(() => {
                // Session may not be fully confirmed yet — will retry on next state poll
            });
    }, [state?.sessionExists, sessionKey]);

    // ── Message poll every 3s ──
    useEffect(() => {
        pollMessages();
        const interval = setInterval(pollMessages, 3000);
        return () => clearInterval(interval);
    }, [pollMessages]);

    // ── Auto-scroll ──
    useEffect(() => {
        msgEnd1.current?.scrollIntoView({ behavior: "smooth" });
        msgEnd2.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Action handlers ──

    const doAction = async (label: string, action: () => Promise<unknown>) => {
        setBusy(label);
        setError(null);
        try {
            await action();
            await refreshState();
            await pollMessages();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Action failed");
        } finally {
            setBusy(null);
        }
    };

    // ── Confirmation flow ──

    const requestConfirm = (title: string, description: string, onConfirm: () => Promise<unknown>) => {
        setPending({ title, description, onConfirm });
    };

    const confirmAction = async () => {
        if (!pending) return;
        const { onConfirm } = pending;
        setPending(null);
        await onConfirm();
    };

    const cancelAction = () => setPending(null);

    // ── Action handlers (all write ops go through confirm popup) ──

    const handleRegister = (userId: 1 | 2) =>
        requestConfirm(
            "Register User",
            `Send a transaction to register User ${userId} on-chain.`,
            () => doAction(`register-${userId}`, () => postRegister(userId)),
        );

    const handleCreateSession = () =>
        requestConfirm(
            "Create Session",
            "Send a transaction to create an encrypted session between User 1 and User 2.",
            () => doAction("session", () => postSession()),
        );

    const handleDeposit = (userId: 1 | 2) => {
        const amount = "1000000000000000000"; // 1 token (1e18 wei)
        requestConfirm(
            "Deposit",
            `Deposit 1 CREDITS for User ${userId} into the contract.`,
            () => doAction(`deposit-${userId}`, () => postDeposit(userId, amount)),
        );
    };

    const handleWithdraw = (userId: 1 | 2) =>
        requestConfirm(
            "Withdraw",
            `Withdraw all deposited CREDITS for User ${userId} from the contract.`,
            () => doAction(`withdraw-${userId}`, () => postWithdraw(userId)),
        );

    const handleSend = (userId: 1 | 2) => {
        const text = userId === 1 ? input1 : input2;
        if (!text.trim()) return;
        doAction(`send-${userId}`, async () => {
            await postSend(userId, text.trim());
            if (userId === 1) setInput1("");
            else setInput2("");
        });
    };

    const handleTransfer = (userId: 1 | 2) => {
        const raw = userId === 1 ? transferAmt1 : transferAmt2;
        const parsed = parseFloat(raw);
        if (isNaN(parsed) || parsed < 0.01) {
            setError("Minimum transfer is 0.01 CREDIT");
            return;
        }
        const toUser = userId === 1 ? 2 : 1;
        // Convert ether string to wei (BigInt)
        const [whole = "0", frac = ""] = raw.split(".");
        const fracPadded = frac.padEnd(18, "0").slice(0, 18);
        const weiStr = (BigInt(whole) * 10n ** 18n + BigInt(fracPadded)).toString();
        requestConfirm(
            "Send CREDIT",
            `Transfer ${parsed} CREDIT from User ${userId} to User ${toUser}.`,
            () => doAction(`transfer-${userId}`, async () => {
                await postTransfer(userId, weiStr);
                if (userId === 1) setTransferAmt1("");
                else setTransferAmt2("");
            }),
        );
    };

    // ── Decrypt toggle ──

    const handleDecryptToggle = async (key: string, encryptedContent: string) => {
        // If already decrypted, just toggle visibility
        if (decryptedTexts[key] !== undefined) {
            setShowDecrypted((prev) => ({ ...prev, [key]: !prev[key] }));
            return;
        }
        // Need to decrypt
        if (!sessionKey) return;
        setDecrypting((prev) => ({ ...prev, [key]: true }));
        try {
            const { plaintext } = await postDecrypt(encryptedContent, sessionKey);
            setDecryptedTexts((prev) => ({ ...prev, [key]: plaintext }));
            setShowDecrypted((prev) => ({ ...prev, [key]: true }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Decryption failed");
        } finally {
            setDecrypting((prev) => ({ ...prev, [key]: false }));
        }
    };

    // ── Loading state ──

    if (!state) {
        return <div className="loading-screen">Connecting to contract...</div>;
    }

    const hasAnyDeposit = state.user1.deposit !== "0" || state.user2.deposit !== "0";
    const canCreateSession =
        state.user1.isRegistered &&
        state.user2.isRegistered &&
        !state.sessionExists &&
        hasAnyDeposit;

    return (
        <div className="container">
            {/* Header */}
            <div className="header">
                <h1>Encrypted Chat Demo</h1>
                <div className="contract-address">
                    Contract: {state.contractAddress}
                </div>
            </div>

            {/* Top bar */}
            <div className="top-bar">
                <span className={`status-badge ${state.sessionExists ? "active" : ""}`}>
                    Session: {state.sessionExists ? "Active" : "None"}
                </span>
                <button
                    className="primary"
                    disabled={!canCreateSession || busy !== null}
                    onClick={handleCreateSession}
                >
                    {busy === "session" ? "Creating Session..." : "Create Session"}
                </button>
                <span className="status-badge">
                    Messages: {totalMsgs}
                </span>
            </div>

            {/* Side-by-side chat */}
            <div className="chat-layout">
                <UserPane
                    label="User 1"
                    userId={1}
                    user={state.user1}
                    otherAddress={state.user2.address}
                    messages={messages}
                    sessionExists={state.sessionExists}
                    input={input1}
                    setInput={setInput1}
                    transferAmt={transferAmt1}
                    setTransferAmt={setTransferAmt1}
                    busy={busy}
                    onRegister={() => handleRegister(1)}
                    onDeposit={() => handleDeposit(1)}
                    onWithdraw={() => handleWithdraw(1)}
                    onSend={() => handleSend(1)}
                    onTransfer={() => handleTransfer(1)}
                    scrollRef={msgEnd1}
                    sessionKey={sessionKey}
                    decryptedTexts={decryptedTexts}
                    showDecrypted={showDecrypted}
                    decryptingKeys={decrypting}
                    onDecryptToggle={handleDecryptToggle}
                />
                <UserPane
                    label="User 2"
                    userId={2}
                    user={state.user2}
                    otherAddress={state.user1.address}
                    messages={messages}
                    sessionExists={state.sessionExists}
                    input={input2}
                    setInput={setInput2}
                    transferAmt={transferAmt2}
                    setTransferAmt={setTransferAmt2}
                    busy={busy}
                    onRegister={() => handleRegister(2)}
                    onDeposit={() => handleDeposit(2)}
                    onWithdraw={() => handleWithdraw(2)}
                    onSend={() => handleSend(2)}
                    onTransfer={() => handleTransfer(2)}
                    scrollRef={msgEnd2}
                    sessionKey={sessionKey}
                    decryptedTexts={decryptedTexts}
                    showDecrypted={showDecrypted}
                    decryptingKeys={decrypting}
                    onDecryptToggle={handleDecryptToggle}
                />
            </div>

            {/* Confirmation popup */}
            {pending && (
                <div className="modal-overlay" onClick={cancelAction}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{pending.title}</h3>
                        <p>{pending.description}</p>
                        <div className="modal-actions">
                            <button onClick={cancelAction}>Cancel</button>
                            <button className="primary" onClick={confirmAction}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Error toast */}
            {error && <div className="error-toast">{error}</div>}
        </div>
    );
}

// ── User Pane Sub-component ──

function UserPane({
    label,
    userId,
    user,
    otherAddress,
    messages,
    sessionExists,
    input,
    setInput,
    transferAmt,
    setTransferAmt,
    busy,
    onRegister,
    onDeposit,
    onWithdraw,
    onSend,
    onTransfer,
    scrollRef,
    sessionKey,
    decryptedTexts,
    showDecrypted,
    decryptingKeys,
    onDecryptToggle,
}: {
    label: string;
    userId: 1 | 2;
    user: UserState;
    otherAddress: string;
    messages: ChatMessage[];
    sessionExists: boolean;
    input: string;
    setInput: (v: string) => void;
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    busy: string | null;
    onRegister: () => void;
    onDeposit: () => void;
    onWithdraw: () => void;
    onSend: () => void;
    onTransfer: () => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    sessionKey: string | null;
    decryptedTexts: Record<string, string>;
    showDecrypted: Record<string, boolean>;
    decryptingKeys: Record<string, boolean>;
    onDecryptToggle: (key: string, encryptedContent: string) => void;
}) {
    const isBusyRegister = busy === `register-${userId}`;
    const isBusyDeposit = busy === `deposit-${userId}`;
    const isBusyWithdraw = busy === `withdraw-${userId}`;
    const isBusySend = busy === `send-${userId}`;
    const isBusyTransfer = busy === `transfer-${userId}`;
    const hasDeposit = user.deposit !== "0";
    const transferValid = parseFloat(transferAmt) >= 0.01;

    return (
        <div className="user-pane">
            {/* Header */}
            <div className="user-header">
                <h2>{label}</h2>
                <div className="address">{user.address}</div>
                <div className="balances">
                    <span>
                        <span className="label">Balance:</span>
                        {formatCredits(user.balance)} CREDITS
                    </span>
                    <span>
                        <span className="label">Deposited:</span>
                        {formatCredits(user.deposit)} CREDITS
                    </span>
                </div>
            </div>

            {/* Actions */}
            <div className="user-actions">
                <button
                    disabled={busy !== null}
                    onClick={onDeposit}
                >
                    {isBusyDeposit ? "Depositing..." : "Deposit 1 CREDITS"}
                </button>
                <button
                    disabled={!hasDeposit || busy !== null}
                    onClick={onWithdraw}
                >
                    {isBusyWithdraw ? "Withdrawing..." : "Withdraw All"}
                </button>
                <button
                    disabled={user.isRegistered || !hasDeposit || busy !== null}
                    onClick={onRegister}
                >
                    {isBusyRegister
                        ? "Registering..."
                        : user.isRegistered
                            ? "Registered ✓"
                            : "Register"}
                </button>
            </div>
            {/* Transfer CREDIT */}
            <div className="transfer-section">
                <div className="transfer-row">
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.01"
                        value={transferAmt}
                        onChange={(e) => setTransferAmt(e.target.value)}
                        disabled={busy !== null}
                        className="transfer-input"
                    />
                    <button
                        disabled={!transferValid || busy !== null}
                        onClick={onTransfer}
                    >
                        {isBusyTransfer
                            ? "Sending..."
                            : `Send CREDIT → User ${userId === 1 ? 2 : 1}`}
                    </button>
                </div>
            </div>
            {/* Messages */}
            <div className="messages-area">
                {!sessionExists ? (
                    <div className="no-messages">No active session</div>
                ) : messages.length === 0 ? (
                    <div className="no-messages">No messages yet</div>
                ) : (
                    messages.map((m) => {
                        const key = `${userId}-${msgKey(m)}`;
                        const isSent = m.sender.toLowerCase() === user.address.toLowerCase();
                        const isRevealed = showDecrypted[key] && decryptedTexts[key] !== undefined;
                        const isDecrypting = decryptingKeys[key];
                        return (
                            <div
                                key={key}
                                className={`message-bubble ${isSent ? "sent" : "received"}`}
                            >
                                <div className="message-content">
                                    {isRevealed
                                        ? decryptedTexts[key]
                                        : `${m.encryptedContent.slice(0, 64)}...`}
                                </div>
                                <div className="meta">
                                    {isSent ? "You" : truncateAddr(m.sender)} &middot; {formatTime(m.timestamp)}
                                    {sessionKey && (
                                        <button
                                            className="decrypt-toggle"
                                            disabled={isDecrypting}
                                            onClick={() => onDecryptToggle(key, m.encryptedContent)}
                                        >
                                            {isDecrypting ? "..." : isRevealed ? "\uD83D\uDD12" : "\uD83D\uDD13"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={scrollRef} />
            </div>

            {/* Compose */}
            <div className="compose-bar">
                <input
                    type="text"
                    placeholder={sessionExists ? "Type a message..." : "Create a session first"}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
                    disabled={!sessionExists || !hasDeposit || busy !== null}
                />
                <button
                    className="primary"
                    disabled={!sessionExists || !hasDeposit || !input.trim() || busy !== null}
                    onClick={onSend}
                >
                    {isBusySend ? "..." : "Send"}
                </button>
            </div>
        </div>
    );
}
