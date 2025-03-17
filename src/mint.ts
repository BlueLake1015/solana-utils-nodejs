import { createAccounts, 
    createOpenBookMarket, 
    createPool, 
    createPoolAndInitialBuy, 
    createToken, 
    getPoolInfo, 
    getTipTransaction, 
    registerAddressLookup, 
    sendBundleConfirmTxId, 
    setFreezeAuthority, 
    setMintAuthority 
} from './utils/solana';

import colors from 'colors';
import fs from 'fs';

const dotenv = require('dotenv');
dotenv.config();

import { clusterApiUrl, Connection, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";

const sleep = (ms : number) => new Promise((r) => setTimeout(r, ms));

const TEST_MODE = process.env.TEST_MODE == 'true'
console.log("TEST_MODE=", TEST_MODE);

const MAINNET_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || clusterApiUrl('mainnet-beta');
const DEVNET_RPC_ENDPOINT = clusterApiUrl('devnet');
const WEB3_ENDPOINT = TEST_MODE ? DEVNET_RPC_ENDPOINT : MAINNET_RPC_ENDPOINT;

const MAX_RETRY = 3;

const connection = new Connection(WEB3_ENDPOINT);

async function mint_token(
    wallet : Keypair,
    tokenName : string,
    tokenSymbol : string,
    tokenDescription : string,
    tokenImage : string,
    tokenTwitter : string,
    tokenTelegram : string,
    tokenWebsite : string
) {
    console.log('tokenImage=', tokenImage);
    // Use pump.fun API: https://pumpportal.fun/creation
    const formData = new FormData();
    formData.append("file", await fs.openAsBlob(tokenImage)), // Image file
    formData.append("name", tokenName),
    formData.append("symbol", tokenSymbol),
    formData.append("description", tokenDescription),
    formData.append("twitter", tokenTwitter),
    formData.append("telegram", tokenTelegram),
    formData.append("website", tokenWebsite),
    formData.append("showName", "true");

    // Create IPFS metadata storage
    const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        body: formData,
    });
    const metadataResponseJSON = await metadataResponse.json();
    console.log("metaDataResponseJSON=", metadataResponseJSON);
    const tokenUri = metadataResponseJSON.metadataUri;

    // -- MINTING TOKEN --
    const tokenAccount = Keypair.generate();
    const JITO_TIP = 0.001
    console.log('Minting Token:', tokenAccount.publicKey.toBase58())
    let retry = 0;
    while (1) {
        try {
            const { mint, transaction } = await createToken(
                tokenAccount,
                connection,
                wallet.publicKey,
                tokenName,
                tokenSymbol,
                tokenUri,
                9,
                10000000000,
                false
            );

            if (transaction) {
                const txns = [transaction];

                try {
                    const revoke_transaction = await setMintAuthority(
                        connection,
                        mint,
                        wallet.publicKey,
                        null
                    );
                    if (revoke_transaction) txns.push(revoke_transaction);
                } catch (err) {
                    console.log(colors.yellow("Failed to set mint authority:"), err);
                }

                try {
                    const freeze_transaction = await setFreezeAuthority(
                        connection,
                        mint,
                        wallet.publicKey,
                        null
                    );
                    if (freeze_transaction) txns.push(freeze_transaction);
                } catch (err) {
                    console.log(colors.yellow("Failed to set freeze authority:"), err);
                }

                for (let i = 0; i < txns.length; i++) {
                    const tx = txns[i]
                    tx.sign([wallet]);
                }

                if (TEST_MODE) {
                    for (let i = 0; i < txns.length; i++) {
                        console.log(`Sending ${i}th transaction`);
                        const signature = await connection.sendTransaction(txns[i]);    
                        const latestBlockHash = await connection.getLatestBlockhash();
                        const confirmation = await connection.confirmTransaction({
                            signature,
                            blockhash: latestBlockHash.blockhash,
                            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                        }, "finalized");
                    }
                    break
                } else {
                    const tipTxn = await getTipTransaction(
                        connection,
                        wallet.publicKey,
                        JITO_TIP
                    );
                    if (tipTxn)
                        txns.push(tipTxn);

                    //@ts-ignore
                    const txHash = base58.encode(txns[0].signatures[0]);
                    const result = await sendBundleConfirmTxId(
                        [txns],
                        [txHash],
                        connection
                    );

                    if (result) {
                        console.log(colors.green("Minting Token Success"));
                        break;
                    }
                }

            }
        } catch (error) {
            console.error(colors.red('Create Token Error:'), error);
        }

        retry++;
        if (retry > MAX_RETRY) return
        console.log(colors.yellow(`Retrying... (${retry}/${MAX_RETRY})`));
        await sleep(1000 * 2 ** retry);
    }
    console.log('Minting Token Success'.green)
    const tokenMint = tokenAccount.publicKey.toBase58();
    console.log("Token Mint Address:", tokenMint);
    // -- END MINTING TOKEN --
}

const WALLET_KEY = [127,246,135,89,115,69,128,50,253,82,195,219,199,102,9,141,19,161,68,163,122,175,214,220,6,72,234,148,41,8,199,100,123,2,123,172,160,220,143,232,105,194,213,202,204,242,6,99,60,56,219,79,128,90,101,126,59,212,158,112,13,149,89,11];

const wallet = Keypair.fromSecretKey(Uint8Array.from(WALLET_KEY));
console.log("wallet address=", wallet.publicKey.toString());

mint_token(
    wallet,
    'BigL',
    'BigL',
    `BigL realized his nose wasn't just for trouble it was for saving lives. That’s when a meme coin was born and a true mission began.`,
    './src/image.png',
    'https://x.com/biglcoin',
    'https://t.me/biglcoin',
    'https://biglcoin.com/'
);
