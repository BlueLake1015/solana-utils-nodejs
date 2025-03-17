import { getMintDecimals } from "@project-serum/serum/lib/market";
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk";
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";


export const getWalletTokenAccount = async (connection: Connection, wallet: PublicKey) => {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
};
  
export const getJitoTipAccount = () => {
    const tipAccounts = [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    ];
    // Randomly select one of the tip addresses
    const selectedTipAccount =
        tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
    return selectedTipAccount;
};

export const getUserWalletBalance = async (publicKey: PublicKey, token: string, connection: Connection) => {
    let sol_balance = 0;
    let token_balance = 0;
    try {
        sol_balance = await connection.getBalance(publicKey, "confirmed");
    } catch (e) {
      // console.log(`error getting sol balance: `, e);
    }
    
    try {
        const token_mint = new PublicKey(token);
        const tokenATA = getAssociatedTokenAddressSync(token_mint, publicKey);
        const tokenAccountInfo = await getAccount(connection, tokenATA);
        const token_decimal = await getMintDecimals(connection, token_mint)
        token_balance = Number(tokenAccountInfo.amount) / Number(10 ** token_decimal);
    } catch (err) {
      // console.log(err);
    }
  
    return { sol_balance, token_balance };
};
  
export const getBatchWalletSolBalance = async (connection: Connection, _walletPubkeys: string[]) => {
    /**
     * wallets count limit 100
     * https://solana.com/docs/rpc/http/getmultipleaccounts
     */
    let totalCount = _walletPubkeys.length;
    let result = [];
    let startIdx = 0;
    while (startIdx < totalCount) {
        const wallets = _walletPubkeys.slice(
            startIdx,
            Math.min(startIdx + 100, totalCount)
        );
        let solBalances = [];
    
        try {
            const rpcRes = await connection.getMultipleAccountsInfo(
                wallets.map((w) => new PublicKey(w))
            );
            solBalances = rpcRes.map((r) => (r?.lamports ?? 0) / LAMPORTS_PER_SOL);
        } catch (e) {
            console.error("error: ", e);
            solBalances = new Array(wallets.length); // fill with 0 when fetch error
        }
    
        result.push(...solBalances);
        startIdx += 100;
    }
    return result;
};
  