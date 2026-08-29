// Server-only environment validation — fails fast on missing vars

const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

export const env = {
    get RPC_URL() { return requireEnv("RPC_URL"); },
    get BITE_ENDPOINT() { return requireEnv("BITE_ENDPOINT"); },
    get CONTRACT_ADDRESS() { return requireEnv("CONTRACT_ADDRESS"); },
    get USER1_PRIVATE_KEY() { return requireEnv("USER1_PRIVATE_KEY"); },
    get USER2_PRIVATE_KEY() { return requireEnv("USER2_PRIVATE_KEY"); },
};
