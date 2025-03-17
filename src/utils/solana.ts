import dotenv from 'dotenv'
import { PROGRAM_ID, createCreateMetadataAccountV3Instruction } from "@metaplex-foundation/mpl-token-metadata";
import {
    buildSimpleTransaction,
    CacheLTA,
    generatePubKey,
    InstructionType,
    jsonInfo2PoolKeys,
    Liquidity,
    LOOKUP_TABLE_CACHE,
    MAINNET_PROGRAM_ID,
    DEVNET_PROGRAM_ID,
    MARKET_STATE_LAYOUT_V2,
    poolKeys2JsonInfo,
    SPL_ACCOUNT_LAYOUT,
    splitTxAndSigners,
    struct,
    Token,
    TOKEN_PROGRAM_ID,
    TokenAmount,
    TxVersion,
    u16,
    u32,
    u64,
    u8
} from "@raydium-io/raydium-sdk";
import {
    getAssociatedTokenAddress,
    getMinimumBalanceForRentExemptMint,
    MINT_SIZE,
    createInitializeMintInstruction,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    createSetAuthorityInstruction,
    AuthorityType,
    getMint,
    createInitializeAccountInstruction,
    NATIVE_MINT,
    createSyncNativeInstruction,
    getAssociatedTokenAddressSync,
    getAccount,
    createTransferInstruction,
} from "@solana/spl-token";
import {
    AddressLookupTableAccount,
    AddressLookupTableProgram,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    StakeInstruction,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction
} from "@solana/web3.js";
import axios from "axios";
import BigNumber from "bignumber.js";
import { BN } from "bn.js";
import bs58 from "bs58";
import { getJitoTipAccount, getWalletTokenAccount } from "./methods";
import { Market, MARKET_STATE_LAYOUT_V3 } from "@project-serum/serum";
dotenv.config();
const TEST_MODE = process.env.TEST_MODE == 'true'
export const JITO_TIMEOUT = 60000;
export const JITO_TIP = 0.001;
export const PROGRAMIDS = TEST_MODE ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID;
export const addLookupTableInfo = TEST_MODE ? undefined : LOOKUP_TABLE_CACHE;
const MAX_WALLET_PER_TX = 8;

const TIMEOUT = 30000;

export function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function getVersionedTransaction(
    connection: Connection,
    ownerPubkey: PublicKey,
    instructionArray: TransactionInstruction[],
    lookupTableAccount: (AddressLookupTableAccount)[] | null = null
) {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // console.log("recentBlockhash", recentBlockhash);

    const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        instructions: instructionArray,
        recentBlockhash: recentBlockhash,
    }).compileToV0Message(lookupTableAccount ? lookupTableAccount : undefined);

    return new VersionedTransaction(messageV0);
}

export async function createToken(
    mintKeypair: Keypair,
    connection: Connection,
    ownerPubkey: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    decimals: number,
    totalSupply: number,
    isMetadataMutable: boolean
) {

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    const tokenATA = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        ownerPubkey
    );

    const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            PROGRAM_ID.toBuffer(),
            mintKeypair.publicKey.toBuffer(),
        ],
        PROGRAM_ID
    );

    const tokenMetadata = {
        name: name,
        symbol: symbol,
        uri: uri,
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
    };

    const instructions = [
        SystemProgram.createAccount({
            fromPubkey: ownerPubkey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            decimals,
            ownerPubkey,
            ownerPubkey,
            TOKEN_PROGRAM_ID
        ),
        createAssociatedTokenAccountInstruction(
            ownerPubkey,
            tokenATA,
            ownerPubkey,
            mintKeypair.publicKey
        ),
        createMintToInstruction(
            mintKeypair.publicKey,
            tokenATA,
            ownerPubkey,
            totalSupply * Math.pow(10, decimals)
        ),
        createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataPDA,
                mint: mintKeypair.publicKey,
                mintAuthority: ownerPubkey,
                payer: ownerPubkey,
                updateAuthority: ownerPubkey,
            },
            {
                createMetadataAccountArgsV3: {
                    data: tokenMetadata,
                    isMutable: isMetadataMutable,
                    collectionDetails: null,
                },
            }
        ),
    ];
    const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
    const message = new TransactionMessage({
        payerKey: ownerPubkey,
        recentBlockhash,
        instructions,
    });
    const transaction = new VersionedTransaction(
        message.compileToV0Message(Object.values({ ...(addLookupTableInfo ?? {}) }))
    );
    transaction.sign([mintKeypair]);

    return {
        mint: mintKeypair.publicKey,
        transaction: transaction,
        metadata: metadataPDA,
    };
}

export async function setMintAuthority(
    connection: Connection,
    mintAddress: PublicKey,
    ownerPubkey: PublicKey,
    newAuthority: PublicKey | null
): Promise<VersionedTransaction> {
    const mint = new PublicKey(mintAddress)
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        instructions: [
            createSetAuthorityInstruction(
                mint,
                ownerPubkey,
                AuthorityType.MintTokens,
                newAuthority ? new PublicKey(newAuthority) : null
            )
        ],
        recentBlockhash: recentBlockhash,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
}

export async function setFreezeAuthority(
    connection: Connection,
    mintAddress: PublicKey,
    ownerPubkey: PublicKey,
    newAuthority: PublicKey | null
) {
    const mint = new PublicKey(mintAddress);

    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        instructions: [
            createSetAuthorityInstruction(
                mint,
                ownerPubkey,
                AuthorityType.FreezeAccount,
                newAuthority ? new PublicKey(newAuthority) : null
            )
        ],
        recentBlockhash: recentBlockhash,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
}

export async function updateRecentBlockHash(connection: Connection, transactions: VersionedTransaction[]) {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // console.log("recentBlockhash", recentBlockhash);

    for (const transaction of transactions) {
        transaction.message.recentBlockhash = recentBlockhash;
    }
}

export async function getTipInstruction(payer: PublicKey, tip: number) {
    try {
        const tipAccount = new PublicKey(getJitoTipAccount());
        const instruction = SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: tipAccount,
            lamports: LAMPORTS_PER_SOL * tip,
        });

        return instruction;
    } catch (err) {
        console.log(err);
    }
    return null;
}

export async function getTipTransaction(connection: Connection, ownerPubkey: PublicKey, tip: number) {
    try {
        const tipAccount = new PublicKey(getJitoTipAccount());
        let instructions = [
            SystemProgram.transfer({
                fromPubkey: ownerPubkey,
                toPubkey: tipAccount,
                lamports: LAMPORTS_PER_SOL * tip,
            }),
        ];

        const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const messageV0 = new TransactionMessage({
            payerKey: ownerPubkey,
            recentBlockhash,
            instructions,
        }).compileToV0Message();

        return new VersionedTransaction(messageV0);
    } catch (err) {
        console.log(err);
    }
    return null;
}

export async function sendBundleConfirmTxId(transactions: ((VersionedTransaction | Transaction)[])[], txHashs: any, connection: Connection) {
    try {
        if (transactions.length === 0) return false;

        //   console.log("Sending bundles...", transactions.length);
        let bundleIds: any[] = [];
        const jito_endpoint = "https://frankfurt.mainnet.block-engine.jito.wtf";
        for (let i = 0; i < transactions.length; i++) {
            const rawTransactions = transactions[i].map((item: any) =>
                bs58.encode(item.serialize())
            );
            const { data } = await axios.post(
                jito_endpoint + "/api/v1/bundles",
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [rawTransactions],
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                }
            );
            if (data) {
                // console.log(data);
                bundleIds = [...bundleIds, data.result];
            }
        }

        //   console.log("Checking bundle's status...", bundleIds);
        const sentTime = Date.now();
        while (Date.now() - sentTime < JITO_TIMEOUT) {
            try {
                let success = true;
                for (let i = 0; i < bundleIds.length; i++) {
                    let txResult = await connection.getTransaction(txHashs[i], {
                        commitment: "confirmed",
                        maxSupportedTransactionVersion: 1,
                    });

                    if (txResult === null) {
                        // console.log("Faild sendBundleConfirmTxId");
                        success = false;
                        break;
                    } else {
                        console.log("checked", bundleIds[i]);
                    }
                }

                if (success) {
                    // console.log("Success sendBundleConfirmTxId");
                    return true;
                }
            } catch (err) {
                console.log(err);
            }

            await sleep(100);
        }
    } catch (err) {
        console.log(err);
    }
    return false;
}

async function makeCreateMarketInstruction({
    connection,
    owner,
    baseInfo,
    quoteInfo,
    lotSize, // 1
    tickSize, // 0.01
    dexProgramId,
    makeTxVersion,
    lookupTableCache,
}: {
    connection: Connection,
    owner: PublicKey,
    baseInfo: Token,
    quoteInfo: Token,
    lotSize: number, // 1
    tickSize: number, // 0.01
    dexProgramId: PublicKey,
    makeTxVersion: any,
    lookupTableCache?: CacheLTA,
}) {
    const market = generatePubKey({
        fromPublicKey: owner,
        programId: dexProgramId,
    });
    const requestQueue = generatePubKey({
        fromPublicKey: owner,
        programId: dexProgramId,
    });
    const eventQueue = generatePubKey({
        fromPublicKey: owner,
        programId: dexProgramId,
    });
    const bids = generatePubKey({
        fromPublicKey: owner,
        programId: dexProgramId,
    });
    const asks = generatePubKey({
        fromPublicKey: owner,
        programId: dexProgramId,
    });
    const baseVault = generatePubKey({
        fromPublicKey: owner,
        programId: TOKEN_PROGRAM_ID,
    });
    const quoteVault = generatePubKey({
        fromPublicKey: owner,
        programId: TOKEN_PROGRAM_ID,
    });
    const feeRateBps = 0;
    const quoteDustThreshold = new BN(100);

    function getVaultOwnerAndNonce() {
        const vaultSignerNonce = new BN(0);
        while (true) {
            try {
                const vaultOwner = PublicKey.createProgramAddressSync(
                    [
                        market.publicKey.toBuffer(),
                        vaultSignerNonce.toArrayLike(Buffer, "le", 8),
                    ],
                    dexProgramId
                );
                return { vaultOwner, vaultSignerNonce };
            } catch (e) {
                vaultSignerNonce.iaddn(1);
                if (vaultSignerNonce.gt(new BN(25555)))
                    throw Error("find vault owner error");
            }
        }
    }

    function initializeMarketInstruction({ programId, marketInfo }: any) {
        const dataLayout = struct([
            u8("version"),
            u32("instruction"),
            u64("baseLotSize"),
            u64("quoteLotSize"),
            u16("feeRateBps"),
            u64("vaultSignerNonce"),
            u64("quoteDustThreshold"),
        ]);

        const keys = [
            { pubkey: marketInfo.id, isSigner: false, isWritable: true },
            { pubkey: marketInfo.requestQueue, isSigner: false, isWritable: true },
            { pubkey: marketInfo.eventQueue, isSigner: false, isWritable: true },
            { pubkey: marketInfo.bids, isSigner: false, isWritable: true },
            { pubkey: marketInfo.asks, isSigner: false, isWritable: true },
            { pubkey: marketInfo.baseVault, isSigner: false, isWritable: true },
            { pubkey: marketInfo.quoteVault, isSigner: false, isWritable: true },
            { pubkey: marketInfo.baseMint, isSigner: false, isWritable: false },
            { pubkey: marketInfo.quoteMint, isSigner: false, isWritable: false },
            // Use a dummy address if using the new dex upgrade to save tx space.
            {
                pubkey: marketInfo.authority
                    ? marketInfo.quoteMint
                    : SYSVAR_RENT_PUBKEY,
                isSigner: false,
                isWritable: false,
            },
        ]
            .concat(
                marketInfo.authority
                    ? { pubkey: marketInfo.authority, isSigner: false, isWritable: false }
                    : []
            )
            .concat(
                marketInfo.authority && marketInfo.pruneAuthority
                    ? {
                        pubkey: marketInfo.pruneAuthority,
                        isSigner: false,
                        isWritable: false,
                    }
                    : []
            );

        const data = Buffer.alloc(dataLayout.span);
        dataLayout.encode(
            {
                version: 0,
                instruction: 0,
                baseLotSize: marketInfo.baseLotSize,
                quoteLotSize: marketInfo.quoteLotSize,
                feeRateBps: marketInfo.feeRateBps,
                vaultSignerNonce: marketInfo.vaultSignerNonce,
                quoteDustThreshold: marketInfo.quoteDustThreshold,
            },
            data
        );

        return new TransactionInstruction({
            keys,
            programId,
            data,
        });
    }

    const { vaultOwner, vaultSignerNonce } = getVaultOwnerAndNonce();

    const ZERO = new BN(0);
    const baseLotSize = new BN(
        Math.round(10 ** baseInfo.decimals * lotSize).toFixed(0)
    );
    const quoteLotSize = new BN(
        Math.round(lotSize * 10 ** quoteInfo.decimals * tickSize).toFixed(0)
    );
    if (baseLotSize.eq(ZERO)) throw Error("lot size is too small");
    if (quoteLotSize.eq(ZERO)) throw Error("tick size or lot size is too small");

    const ins1 = [];
    const accountLamports = await connection.getMinimumBalanceForRentExemption(165);
    ins1.push(
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: baseVault.seed,
            newAccountPubkey: baseVault.publicKey,
            lamports: accountLamports,
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: quoteVault.seed,
            newAccountPubkey: quoteVault.publicKey,
            lamports: accountLamports,
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(
            baseVault.publicKey,
            baseInfo.mint,
            vaultOwner
        ),
        createInitializeAccountInstruction(
            quoteVault.publicKey,
            quoteInfo.mint,
            vaultOwner
        )
    );

    const EVENT_QUEUE_ITEMS = 128; // Default: 2978
    const REQUEST_QUEUE_ITEMS = 63; // Default: 63
    const ORDERBOOK_ITEMS = 201; // Default: 909

    const eventQueueSpace = EVENT_QUEUE_ITEMS * 88 + 44 + 48;
    const requestQueueSpace = REQUEST_QUEUE_ITEMS * 80 + 44 + 48;
    const orderBookSpace = ORDERBOOK_ITEMS * 80 + 44 + 48;

    const ins2 = [];
    ins2.push(
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: market.seed,
            newAccountPubkey: market.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(
                MARKET_STATE_LAYOUT_V2.span
            ),
            space: MARKET_STATE_LAYOUT_V2.span,
            programId: dexProgramId,
        }),
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: requestQueue.seed,
            newAccountPubkey: requestQueue.publicKey,
            lamports:
                await connection.getMinimumBalanceForRentExemption(requestQueueSpace),
            space: requestQueueSpace,
            programId: dexProgramId,
        }),
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: eventQueue.seed,
            newAccountPubkey: eventQueue.publicKey,
            lamports:
                await connection.getMinimumBalanceForRentExemption(eventQueueSpace),
            space: eventQueueSpace,
            programId: dexProgramId,
        }),
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: bids.seed,
            newAccountPubkey: bids.publicKey,
            lamports:
                await connection.getMinimumBalanceForRentExemption(orderBookSpace),
            space: orderBookSpace,
            programId: dexProgramId,
        }),
        SystemProgram.createAccountWithSeed({
            fromPubkey: owner,
            basePubkey: owner,
            seed: asks.seed,
            newAccountPubkey: asks.publicKey,
            lamports:
                await connection.getMinimumBalanceForRentExemption(orderBookSpace),
            space: orderBookSpace,
            programId: dexProgramId,
        }),
        initializeMarketInstruction({
            programId: dexProgramId,
            marketInfo: {
                id: market.publicKey,
                requestQueue: requestQueue.publicKey,
                eventQueue: eventQueue.publicKey,
                bids: bids.publicKey,
                asks: asks.publicKey,
                baseVault: baseVault.publicKey,
                quoteVault: quoteVault.publicKey,
                baseMint: baseInfo.mint,
                quoteMint: quoteInfo.mint,
                baseLotSize: baseLotSize,
                quoteLotSize: quoteLotSize,
                feeRateBps: feeRateBps,
                vaultSignerNonce: vaultSignerNonce,
                quoteDustThreshold: quoteDustThreshold,
            },
        })
    );

    const ins = {
        address: {
            marketId: market.publicKey,
            requestQueue: requestQueue.publicKey,
            eventQueue: eventQueue.publicKey,
            bids: bids.publicKey,
            asks: asks.publicKey,
            baseVault: baseVault.publicKey,
            quoteVault: quoteVault.publicKey,
            baseMint: baseInfo.mint,
            quoteMint: quoteInfo.mint,
        },
        innerTransactions: [
            {
                instructions: ins1,
                signers: [],
                instructionTypes: [
                    InstructionType.createAccount,
                    InstructionType.createAccount,
                    InstructionType.initAccount,
                    InstructionType.initAccount,
                ],
            },
            {
                instructions: ins2,
                signers: [],
                instructionTypes: [
                    InstructionType.createAccount,
                    InstructionType.createAccount,
                    InstructionType.createAccount,
                    InstructionType.createAccount,
                    InstructionType.createAccount,
                    InstructionType.initMarket,
                ],
            },
        ],
    };

    return {
        address: ins.address,
        innerTransactions: await splitTxAndSigners({
            connection,
            makeTxVersion,
            computeBudgetConfig: undefined,
            payer: owner,
            innerTransaction: ins.innerTransactions,
            lookupTableCache,
        }),
    };
}

export async function createOpenBookMarket(
    connection: Connection,
    baseMintAddress: string,
    quoteMintAddress: string,
    lotSize: number,
    tickSize: number,
    ownerPubkey: PublicKey
) {
    console.log(
        "Creating OpenBook Market...",
        baseMintAddress,
        lotSize,
        tickSize,
        PROGRAMIDS.OPENBOOK_MARKET.toBase58()
    );

    const baseMint = new PublicKey(baseMintAddress);
    const baseMintInfo = await getMint(connection, baseMint);

    const quoteMint = new PublicKey(quoteMintAddress);
    const quoteMintInfo = await getMint(connection, quoteMint);

    const marketAccounts = await Market.findAccountsByMints(
        connection,
        baseMint,
        quoteMint,
        PROGRAMIDS.OPENBOOK_MARKET
    );
    if (marketAccounts.length > 0) {
        console.log("Already created OpenBook market!");
        console.log(marketAccounts[0].publicKey.toBase58());
        return { marketId: marketAccounts[0].publicKey };
    }

    const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        baseMint,
        baseMintInfo.decimals
    );
    const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        quoteMint,
        quoteMintInfo.decimals
    );
    // console.log("Creating Transactions...");
    // -------- step 1: make instructions --------
    const { innerTransactions, address } = await makeCreateMarketInstruction({
        connection,
        owner: ownerPubkey,
        baseInfo: baseToken,
        quoteInfo: quoteToken,
        lotSize: lotSize,
        tickSize: tickSize,
        dexProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        makeTxVersion: TxVersion.V0,
    });
    const recentBlockhash = await connection.getLatestBlockhash('finalized');
    const transactions = await buildSimpleTransaction({
        connection,
        makeTxVersion: TxVersion.V0,
        payer: ownerPubkey,
        innerTransactions,
        addLookupTableInfo,
        recentBlockhash: recentBlockhash.blockhash
    });

    return { marketId: address.marketId, transactions };
}

export async function createPool(
    connection: Connection,
    baseMintAddress: string,
    baseMintAmount: number,
    quoteMintAddress: string,
    quoteMintAmount: number,
    marketId: string,
    ownerPubkey: PublicKey
) {
    const baseMint = new PublicKey(baseMintAddress);
    const baseMintInfo = await getMint(connection, baseMint);

    const quoteMint = new PublicKey(quoteMintAddress);
    const quoteMintInfo = await getMint(connection, quoteMint);

    const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        baseMint,
        baseMintInfo.decimals
    );
    const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        quoteMint,
        quoteMintInfo.decimals
    );

    const baseAmount = new BN(
        new BigNumber(
            baseMintAmount.toString() + "e" + baseMintInfo.decimals.toString()
        ).toFixed(0)
    );
    const quoteAmount = new BN(
        new BigNumber(
            quoteMintAmount.toString() + "e" + quoteMintInfo.decimals.toString()
        ).toFixed(0)
    );
    const walletTokenAccounts = await getWalletTokenAccount(
        connection,
        ownerPubkey
    );
    const startTime = Math.floor(Date.now() / 1000);

    const { innerTransactions } =
        await Liquidity.makeCreatePoolV4InstructionV2Simple({
            connection,
            programId: PROGRAMIDS.AmmV4,
            marketInfo: {
                marketId: new PublicKey(marketId),
                programId: PROGRAMIDS.OPENBOOK_MARKET,
            },
            baseMintInfo: baseToken,
            quoteMintInfo: quoteToken,
            baseAmount: baseAmount,
            quoteAmount: quoteAmount,
            startTime: new BN(startTime),
            ownerInfo: {
                feePayer: ownerPubkey,
                wallet: ownerPubkey,
                tokenAccounts: walletTokenAccounts,
                useSOLBalance: true,
            },
            associatedOnly: false,
            checkCreateATAOwner: true,
            makeTxVersion: TxVersion.V0,
            feeDestinationId: new PublicKey(
                TEST_MODE ? "3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR" : "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"
            ),
        });

    const tipAccount = new PublicKey(getJitoTipAccount());
    let newInnerTransactions = [...innerTransactions];
    if (newInnerTransactions.length > 0) {
        const p = newInnerTransactions.length - 1;
        newInnerTransactions[p].instructionTypes = [
            // bugfly
            50,
            // 50, 50,
            ...newInnerTransactions[p].instructionTypes,
        ];
        newInnerTransactions[p].instructions = [
            SystemProgram.transfer({
                fromPubkey: ownerPubkey,
                toPubkey: tipAccount,
                lamports: LAMPORTS_PER_SOL * JITO_TIP,
            }),
            ...newInnerTransactions[p].instructions,
        ];
    }

    const transactions = await buildSimpleTransaction({
        connection,
        makeTxVersion: TxVersion.V0,
        payer: ownerPubkey,
        innerTransactions: newInnerTransactions,
    });

    return transactions;
}

export async function createPoolAndInitialBuy(
    connection: Connection,
    poolInfo: any,
    token: string,
    keypairs: Keypair[],
    solAmounts: number[],
    signedTransactions: (Transaction | VersionedTransaction)[],
    lookupTableAccounts: (AddressLookupTableAccount)[] | null
) {
    const poolKeys = jsonInfo2PoolKeys(poolInfo);
    const baseMint = new PublicKey(token);
    const baseMintInfo = await getMint(connection, baseMint);

    const finalTxs = [];
    let idxKeypair = 0;
    while (idxKeypair < keypairs.length) {
        const keypairSlices = keypairs.slice(
            idxKeypair,
            idxKeypair + MAX_WALLET_PER_TX
        );

        const instructions = [];
        for (let idx = 0; idx < keypairSlices.length; idx++) {
            let raydiumInstructions: TransactionInstruction[] | null = [];

            while (1) {
                const result = await getBuyTokenInstructions(
                    connection,
                    poolKeys,
                    baseMint,
                    baseMintInfo.decimals,
                    solAmounts[idxKeypair + idx],
                    keypairSlices[idx].publicKey,
                    true
                );

                if (result !== null) {
                    raydiumInstructions = result;
                    break;
                }
            }

            // console.log('raydiumInstructions', raydiumInstructions);

            const swapInstruction = raydiumInstructions[2];
            const wrappedAccount = await getAssociatedTokenAddress(
                NATIVE_MINT,
                keypairSlices[idx].publicKey
            );
            // console.log(
            //     "raydiumInstructions",
            //     keypairSlices[idx].publicKey.toBase58(),
            //     wrappedAccount.toBase58()
            // );
            // console.log("swapInstruction :".red, swapInstruction)
            // console.log("swapInstruction.keys :".red, swapInstruction.keys)
            // console.log("swapInstruction.keys[15] :".red, swapInstruction.keys[15])
            swapInstruction.keys[15].pubkey = wrappedAccount;

            instructions.push(swapInstruction);
        }

        const tx = await getVersionedTransaction(
            connection,
            keypairSlices[0].publicKey,
            instructions,
            lookupTableAccounts
        );

        // console.log(await connection.simulateTransaction(tx));
        finalTxs.push(tx);
        idxKeypair += MAX_WALLET_PER_TX;
    }

    await updateRecentBlockHash(connection, finalTxs);

    let idx = 0;
    for (const tx of finalTxs) {
        // console.log("idx", idx);
        const keypairSlices = keypairs.slice(
            idx * MAX_WALLET_PER_TX,
            (idx + 1) * MAX_WALLET_PER_TX
        );
        tx.sign(keypairSlices);
        idx++;
    }

    if (TEST_MODE) {
        const txns = [...signedTransactions, ...finalTxs];
        for(let i = 0; i < txns.length; i ++) {
            // @ts-ignore
            const txId = await connection.sendTransaction(txns[i])
            console.log(await connection.confirmTransaction(txId))
        }
        return true
    } else {
        const txHash = bs58.encode(finalTxs[0].signatures[0]);
        // console.log("createPoolAndInitialBuy txHash :>> ", txHash);
        return await sendBundleConfirmTxId(
            [[...signedTransactions, ...finalTxs]],
            [txHash],
            connection
        );
    }
}

export async function getPoolInfo(connection: Connection, token: string) {

    if (!token) {
        console.log("Invalid token address");
        return null;
    }

    const mint = new PublicKey(token);
    const mintInfo = await getMint(connection, mint);

    const baseToken = new Token(TOKEN_PROGRAM_ID, token, mintInfo.decimals);
    const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        "So11111111111111111111111111111111111111112",
        9,
        "WSOL",
        "WSOL"
    );

    let marketAccounts: any[] = []
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        marketAccounts = await Market.findAccountsByMints(
            connection,
            baseToken.mint,
            quoteToken.mint,
            PROGRAMIDS.OPENBOOK_MARKET
        );

        if (marketAccounts.length > 0) {
            break;
        }

        sleep(1000);
    }
    if (marketAccounts.length === 0) {
        console.log("Not found market info");
        return null;
    }

    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(
        marketAccounts[0].accountInfo.data
    );
    let poolKeys: any = Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        baseMint: baseToken.mint,
        quoteMint: quoteToken.mint,
        baseDecimals: baseToken.decimals,
        quoteDecimals: quoteToken.decimals,
        marketId: marketAccounts[0].publicKey,
        programId: PROGRAMIDS.AmmV4,
        marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
    });
    // console.log("poolKeys :".red, poolKeys)
    poolKeys.marketBaseVault = marketInfo.baseVault;
    poolKeys.marketQuoteVault = marketInfo.quoteVault;
    poolKeys.marketBids = marketInfo.bids;
    poolKeys.marketAsks = marketInfo.asks;
    poolKeys.marketEventQueue = marketInfo.eventQueue;

    return poolKeys2JsonInfo(poolKeys);
}

export async function createAccounts(
    connection: Connection,
    lookupTableAccounts: (AddressLookupTableAccount)[],
    wallets: Keypair[],
    token: string,
    solAmounts: number[],
    payer: Keypair
) {
    const instructions = [];
    const mint = new PublicKey(token);

    // console.log(solAmounts);

    const jitoInst = await getTipInstruction(payer.publicKey, JITO_TIP);

    if (jitoInst == null) {
        console.log("Can't get jito fee instruction!");
        return null;
    }

    instructions.push(jitoInst);

    let instruction_ratio = 1;
    let idx = 0;
    for (const element of wallets) {
        const wallet = element.publicKey;
        const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
        if (!(await connection.getAccountInfo(tokenAccount))) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    tokenAccount,
                    wallet,
                    mint
                )
            );
        }

        const wrappedAccount = await getAssociatedTokenAddress(NATIVE_MINT, wallet);
        if (!(await connection.getAccountInfo(wrappedAccount))) {
            instruction_ratio = 2.5
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    wrappedAccount,
                    wallet,
                    NATIVE_MINT
                )
            );

            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: wrappedAccount,
                    lamports: Number((LAMPORTS_PER_SOL * solAmounts[idx]).toFixed()),
                })
            );
            instructions.push(createSyncNativeInstruction(wrappedAccount));
        }
        else {
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: wrappedAccount,
                    lamports: Number((LAMPORTS_PER_SOL * solAmounts[idx]).toFixed()),
                })
            );
            instructions.push(createSyncNativeInstruction(wrappedAccount));
        }

        if (idx % MAX_WALLET_PER_TX == 0) {
            console.log("createAccounts idx", idx);
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: wallet,
                    lamports: LAMPORTS_PER_SOL * 0.004,
                })
            );
        }

        idx++;
    }

    if (instructions.length == 1) {
        console.log("No need to create accounts");
        return false;
    }

    let finalTxs = [];

    // console.log("total instruction count ", instructions.length);

    idx = 0;
    while (idx < instructions.length) {
        const batchInstrunction = instructions.slice(
            idx,
            idx + MAX_WALLET_PER_TX * instruction_ratio
        );
        // console.log("batchInstrunction", batchInstrunction);
        const tx = await getVersionedTransaction(
            connection,
            payer.publicKey,
            batchInstrunction,
            lookupTableAccounts
        );

        // console.log("tx length", tx.serialize().length, idx);
        finalTxs.push(tx);
        idx += MAX_WALLET_PER_TX * instruction_ratio;

        if (finalTxs.length == 5) {
            await updateRecentBlockHash(connection, finalTxs);

            for (const tx of finalTxs) {
                tx.sign([payer]);
            }
            if (TEST_MODE) {
                for (let i = 0; i < finalTxs.length; i++) {
                    const txId = await connection.sendTransaction(finalTxs[i])
                    console.log(await connection.confirmTransaction(txId));
                }
            } else {
                const txHash = bs58.encode(finalTxs[0].signatures[0]);
                // console.log("createAccounts txHash1 :>> ", txHash);
                const result = await sendBundleConfirmTxId(
                    [finalTxs],
                    [txHash],
                    connection
                );
                if (!result) return false;
            }

            finalTxs = [];
            instructions.push(jitoInst);
        }
    }

    if (finalTxs.length > 1) {
        await updateRecentBlockHash(connection, finalTxs);

        for (const tx of finalTxs) {
            tx.sign([payer]);
        }
        if (TEST_MODE) {
            for (let i = 0; i < finalTxs.length; i++) {
                const txId = await connection.sendTransaction(finalTxs[i])
                console.log(await connection.confirmTransaction(txId));
            }
        } else {
            const txHash = bs58.encode(finalTxs[0].signatures[0]);
            // console.log("createAccounts txHash2 :>> ", txHash);
            const result = await sendBundleConfirmTxId(
                [finalTxs],
                [txHash],
                connection
            );
            if (!result) return false;
        }

        finalTxs = [];
    }

    let bTA1 = false;
    let bTA2 = false;
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        const tokenAccount1 = await getAssociatedTokenAddress(mint, wallets[0].publicKey);
        const tokenAccount2 = await getAssociatedTokenAddress(mint, wallets[wallets.length - 1].publicKey);
        if (!bTA1 && await connection.getAccountInfo(tokenAccount1))
            bTA1 = true
        if (!bTA2 && await connection.getAccountInfo(tokenAccount2))
            bTA2 = true

        if (bTA1 && bTA2)
            return true;

        sleep(1000);
    }
    return false;
}

export async function disperseSOLs(
    connection: Connection,
    publicKey: PublicKey,
    signer: Keypair,
    wallets: string[],
    solAmount: number
) {
    const tipAccount = new PublicKey(getJitoTipAccount());

    let bundleIndex = -1;
    let bundleItems = [];
    let index = 0;
    while (index < wallets.length) {
        let count = wallets.length - index;
        if (count > 13) count = 13;

        let instructions = [];
        for (let i = index; i < index + count; i++) {
            let amount = 0.03;
            if (i === 0) amount = 0.3 + solAmount;

            // console.log(amount.toString() + "e9")
            const bnAmount = new BN(
                new BigNumber(amount.toString() + "e9").toFixed(0)
            );
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: new PublicKey(wallets[i]),
                    lamports: bnAmount.toNumber(),
                })
            );
        }

        if (instructions.length > 0) {
            // console.log(
            //     `Transfer Instructions(${index}-${index + count - 1}):`,
            //     instructions.length
            // );
            if (bundleItems[bundleIndex] && bundleItems[bundleIndex].length < 5) {
                bundleItems[bundleIndex].push({
                    instructions: instructions,
                    payer: publicKey,
                });
            } else {
                bundleItems.push([
                    {
                        instructions: instructions,
                        payer: publicKey,
                    },
                ]);
                bundleIndex++;
            }
        }

        index += count;
    }

    // console.log("Bundle Items:", bundleItems.length);
    let bundleTxns = [];
    let txHashs = [];
    for (let i = 0; i < bundleItems.length; i++) {
        const bundleItem = bundleItems[i];
        // console.log("Bundle", i, bundleItem.length);
        let verTxns = [];
        for (let j = 0; j < bundleItem.length; j++) {
            if (j === bundleItem.length - 1) {
                bundleItem[j].instructions = [
                    SystemProgram.transfer({
                        fromPubkey: bundleItem[j].payer,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    }),
                    ...bundleItem[j].instructions,
                ];
            }
            const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            const transactionMessage = new TransactionMessage({
                payerKey: bundleItem[j].payer,
                instructions: bundleItem[j].instructions,
                recentBlockhash,
            });
            const tx = new VersionedTransaction(
                transactionMessage.compileToV0Message()
            );
            tx.sign([signer]);
            verTxns.push(tx);
        }

        const txHash = bs58.encode(verTxns[0].signatures[0]);
        // console.log("txHash :>> ", txHash);
        txHashs.push(txHash);
        bundleTxns.push(verTxns);
    }

    return await sendBundleConfirmTxId(bundleTxns, txHashs, connection);
}

const createAddressLookupWithAddressList = async (
    connection: Connection,
    addressList: any[],
    payer: Keypair
) => {
    const slot = await connection.getSlot();
    const [lookupTableInst, lookupTableAddress] =
        AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot,
        });

    // console.log("lookupTableAddress:", lookupTableAddress.toBase58());

    let idx = 0;
    const batchSize = 20;

    const instructions = [];

    instructions.push(lookupTableInst);

    while (idx < addressList.length) {
        const batch = addressList.slice(idx, idx + batchSize);

        const extendInstruction = AddressLookupTableProgram.extendLookupTable({
            payer: payer.publicKey,
            authority: payer.publicKey,
            lookupTable: lookupTableAddress,
            addresses: batch,
        });

        instructions.push(extendInstruction);

        idx += batchSize;
    }

    let finalTxs = [];

    for (idx = 0; idx < instructions.length; idx++) {
        let tx;

        if (finalTxs.length == 0) {
            const jitoInstrunction = await getTipInstruction(
                payer.publicKey,
                JITO_TIP
            );

            if (jitoInstrunction == null) {
                console.log("Can't get jito tip instruction");
                return lookupTableAddress;
            }

            tx = await getVersionedTransaction(connection, payer.publicKey, [
                instructions[idx],
                jitoInstrunction,
            ]);
        } else {
            tx = await getVersionedTransaction(connection, payer.publicKey, [
                instructions[idx],
            ]);
        }

        finalTxs.push(tx);

        if (finalTxs.length == 5) {
            await updateRecentBlockHash(connection, finalTxs);

            for (const tx of finalTxs) {
                tx.sign([payer]);
            }
            if (TEST_MODE) {
                for (let i = 0; i < finalTxs.length; i++) {
                    const txId = await connection.sendTransaction(finalTxs[i])
                    console.log(await connection.confirmTransaction(txId))
                }
            } else {
                const txHash = bs58.encode(finalTxs[0].signatures[0]);
                // console.log("createAddressLookupWithAddressList txHash1 :>> ", txHash);
                const result = await sendBundleConfirmTxId([finalTxs], [txHash], connection);
                if (result === false)
                    return null;
            }


            finalTxs = [];
        }
    }

    if (finalTxs.length > 0) {
        await sleep(1500);
        await updateRecentBlockHash(connection, finalTxs);

        for (const tx of finalTxs) {
            tx.sign([payer]);
        }
        if (TEST_MODE) {
            for (let i = 0; i < finalTxs.length; i++) {
                const txId = await connection.sendTransaction(finalTxs[i])
                console.log(await connection.confirmTransaction(txId))
            }
        } else {
            const txHash = bs58.encode(finalTxs[0].signatures[0]);
            // console.log("createAddressLookupWithAddressList txHash2 :>> ", txHash);
            await sendBundleConfirmTxId([finalTxs], [txHash], connection);
        }
        finalTxs = [];
    }

    return lookupTableAddress;
};

export async function registerAddressLookup(
    connection: Connection,
    poolInfo: any,
    wallets: Keypair[],
    payer: Keypair
): Promise<AddressLookupTableAccount[]> {
    console.log("poolInfo : ", poolInfo);
    const poolKeys = jsonInfo2PoolKeys(poolInfo);
    // console.log("poolKeys :".red, poolKeys);
    const addressListFromPoolKey = [
        TOKEN_PROGRAM_ID,
        poolKeys.id,
        poolKeys.programId,
        poolKeys.authority,
        poolKeys.baseVault,
        poolKeys.quoteVault,
        poolKeys.openOrders,
        poolKeys.targetOrders,
        poolKeys.marketProgramId,
        poolKeys.marketId,
        poolKeys.marketAuthority,
        poolKeys.marketBaseVault,
        poolKeys.marketQuoteVault,
        poolKeys.marketBids,
        poolKeys.marketAsks,
        poolKeys.marketEventQueue,
    ];

    addressListFromPoolKey.push(payer.publicKey);

    for (let idx = 0; idx < wallets.length; idx++) {
        const wallet = wallets[idx].publicKey;
        const tokenAccount = await getAssociatedTokenAddress(
            poolKeys.baseMint,
            wallet
        );
        const wrappedAccount = await getAssociatedTokenAddress(NATIVE_MINT, wallet);
        addressListFromPoolKey.push(wallet);
        addressListFromPoolKey.push(tokenAccount);
        addressListFromPoolKey.push(wrappedAccount);
    }

    const firstAddressLookup = await createAddressLookupWithAddressList(
        connection,
        addressListFromPoolKey,
        payer
    );
    // const firstAddressLookup = new PublicKey(
    //   "EdR9mSNpkTQgBivaHr6em9HHuMgcAqxCLZNKFcMYKiv8"
    // );

    if (!firstAddressLookup) return [];

    let lookupTableAccount;
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        // console.log("---- verifing lookup Table", firstAddressLookup)
        lookupTableAccount = (await connection.getAddressLookupTable(firstAddressLookup));

        if (lookupTableAccount.value && lookupTableAccount.value.state && lookupTableAccount.value.state.addresses.length >= addressListFromPoolKey.length) {
            // console.log(`https://explorer.solana.com/address/${firstAddressLookup.toString()}/entries?cluster=mainnet`)
            break;
        }
        await sleep(1000)
    }

    const addressLookupTable = lookupTableAccount?.value;

    // console.log("addressLookupTable :", addressLookupTable);

    if (!addressLookupTable)
        return [];

    const lookupTableAccounts = [];

    lookupTableAccounts.push(
        addressLookupTable
    );

    return lookupTableAccounts;
}

export async function disperseTokens(
    connection: Connection,
    token: string,
    mainWallets: Keypair[],
    childWallets: PublicKey[]
) {
    try {
        if (!token) {
            console.log("Please set your token address!!");
            return false;
        }

        const mint = new PublicKey(token);

        let fromAccounts = [];
        let fromTokenAccounts = [];
        let transferAmounts = [];
        let transferCounts = [];
        const mod = childWallets.length % mainWallets.length;
        for (let i = 0; i < mainWallets.length; i++) {
            const fromAcount = mainWallets[i];
            const fromTokenAccount = getAssociatedTokenAddressSync(
                mint,
                fromAcount.publicKey
            );
            if (!fromTokenAccount) {
                console.log("Please set your token address!!".red);
                continue;
            }
            const tokenAccountInfo = await getAccount(connection, fromTokenAccount);
            const balance = new BigNumber(tokenAccountInfo.amount.toString());
            // console.log("balance", balance.toString());

            let transferCount = 0;
            if (mod > i)
                transferCount = Math.floor(childWallets.length / mainWallets.length) + 1;
            else transferCount = Math.floor(childWallets.length / mainWallets.length);

            fromAccounts.push(fromAcount);
            fromTokenAccounts.push(fromTokenAccount);
            transferCounts.push(transferCount);

            transferCount++;

            const transferCountBN = new BigNumber(transferCount.toString());
            const transferAmount = balance.dividedBy(transferCountBN).dp(0, 6);
            transferAmounts.push(new BN(transferAmount.toFixed(0)));
        }

        let bundleItems = [];
        let bundleIndex = -1;
        let index = 0;
        for (let slot = 0; slot < fromAccounts.length; slot++) {
            const signers = [fromAccounts[slot], mainWallets[0]];
            const slotCount = index + transferCounts[slot];
            const startIndex = index;
            let diffAmount = new BN(0);
            while (index < slotCount) {
                let count = 0;
                let instructions = [];
                for (let i = index; i < slotCount; i++) {
                    const toPublicKey = childWallets[i];
                    const toTokenAccount = getAssociatedTokenAddressSync(
                        mint,
                        toPublicKey
                    );
                    try {
                        const info = await connection.getAccountInfo(toTokenAccount);
                        if (!info) {
                            instructions.push(
                                createAssociatedTokenAccountInstruction(
                                    fromAccounts[slot].publicKey,
                                    toTokenAccount,
                                    toPublicKey,
                                    mint
                                )
                            );
                        }
                    } catch (err) {
                        console.log(err);
                    }

                    let transferAmount = transferAmounts[slot];
                    if ((i - startIndex) % 2 == 0) {
                        diffAmount = transferAmounts[slot].muln(
                            Math.random() * (0.1 - 0.05) + 0.05
                        );
                        transferAmount = transferAmounts[slot].sub(diffAmount);
                    } else {
                        transferAmount = transferAmounts[slot].add(diffAmount);
                    }

                    // console.log("transferAmounts", slot, i, transferAmount.toString());
                    instructions.push(
                        createTransferInstruction(
                            fromTokenAccounts[slot],
                            toTokenAccount,
                            fromAccounts[slot].publicKey,
                            transferAmount.toNumber()
                        )
                    );

                    count++;
                    if (count === 5) break;
                }

                if (instructions.length > 0) {
                    if (bundleItems[bundleIndex] && bundleItems[bundleIndex].length < 5) {
                        bundleItems[bundleIndex].push({
                            instructions: instructions,
                            signers: signers,
                            payer: mainWallets[0].publicKey,
                        });
                    } else {
                        bundleItems.push([
                            {
                                instructions: instructions,
                                signers: signers,
                                payer: mainWallets[0].publicKey,
                            },
                        ]);
                        bundleIndex++;
                    }
                } else break;

                index += count;
            }
        }

        // console.log("Bundle Items:", bundleItems.length);
        let bundleTxns = [];
        let txHashs = [];
        const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const tipAccount = new PublicKey(getJitoTipAccount());
        for (let i = 0; i < bundleItems.length; i++) {
            let bundleItem = bundleItems[i];
            // console.log("Bundle", i, bundleItem.length);
            let verTxns = [];
            for (let j = 0; j < bundleItem.length; j++) {
                if (j === bundleItem.length - 1) {
                    bundleItem[j].instructions = [
                        SystemProgram.transfer({
                            fromPubkey: bundleItem[j].payer,
                            toPubkey: tipAccount,
                            lamports: LAMPORTS_PER_SOL * JITO_TIP,
                        }),
                        ...bundleItem[j].instructions,
                    ];
                }
                const transactionMessage = new TransactionMessage({
                    payerKey: bundleItem[j].payer,
                    instructions: bundleItem[j].instructions,
                    recentBlockhash,
                });
                const tx = new VersionedTransaction(
                    transactionMessage.compileToV0Message()
                );
                tx.sign(bundleItem[j].signers);
                // console.log(await connection.simulateTransaction(tx));
                verTxns.push(tx);
            }

            const txHash = bs58.encode(verTxns[0].signatures[0]);
            // console.log("txHash :>> ", txHash);
            txHashs.push(txHash);
            bundleTxns.push(verTxns);
        }

        return await sendBundleConfirmTxId(bundleTxns, txHashs, connection);
    } catch (err) {
        // console.log(err);
        return false;
    }
}

export const getBuyTokenInstructions = async (
    connection: Connection,
    poolKeys: any,
    tokenAddress: PublicKey,
    tokenDecimals: number,
    solAmount: Number,
    signerPubkey: PublicKey,
    tokenBase: boolean,
    slipage = 1
) => {
    try {
        let baseToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, tokenDecimals);
        let quoteToken = new Token(
            TOKEN_PROGRAM_ID,
            "So11111111111111111111111111111111111111112",
            9
        );

        // console.log("signerPubkey", signerPubkey.toString());

        if (tokenBase == false) {
            quoteToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, tokenDecimals);
            baseToken = new Token(
                TOKEN_PROGRAM_ID,
                "So11111111111111111111111111111111111111112",
                9
            );
        }

        let swapSolAmount = tokenBase
            ? new TokenAmount(quoteToken, solAmount.toFixed(9), false)
            : new TokenAmount(baseToken, solAmount.toFixed(9), false);

        // const slippage = new Percent(100, 100);
        // console.log("computeAmountOut");
        // const { minAmountOut: swapTokenAmount } = Liquidity.computeAmountOut({
        //   poolKeys: poolKeys,
        //   poolInfo: await Liquidity.fetchInfo({
        //     connection: connection,
        //     poolKeys,
        //   }),
        //   amountIn: swapSolAmount,
        //   currencyOut: tokenBase ? baseToken : quoteToken,
        //   slippage: slippage,
        // });
        // console.log("swapSolAmount", swapSolAmount.toFixed(baseToken.decimals));
        // console.log(
        //   "swapTokenAmount",
        //   swapTokenAmount.toFixed(quoteToken.decimals)
        // );

        let walletTokenAccounts = [];
        {
            const allWalletTokenAccounts = await connection.getTokenAccountsByOwner(
                new PublicKey(signerPubkey),
                {
                    programId: TOKEN_PROGRAM_ID,
                }
            );

            const tokenAccounts = allWalletTokenAccounts.value;
            for (let i = 0; i < tokenAccounts.length; i++) {
                const accountInfo = SPL_ACCOUNT_LAYOUT.decode(
                    tokenAccounts[i].account.data
                );

                if (
                    accountInfo.mint.toString() != baseToken.mint.toString() &&
                    accountInfo.mint.toString() != quoteToken.mint.toString()
                )
                    continue;

                walletTokenAccounts.push({
                    pubkey: tokenAccounts[i].pubkey,
                    programId: tokenAccounts[i].account.owner,
                    accountInfo: accountInfo,
                });
            }
        }

        const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
            connection: connection,
            poolKeys,
            userKeys: {
                tokenAccounts: walletTokenAccounts,
                owner: new PublicKey(signerPubkey),
            },
            amountIn: swapSolAmount,
            amountOut: new TokenAmount(baseToken, slipage, false),
            fixedSide: "in",
            makeTxVersion: TxVersion.V0,
        });

        // console.log("inst", innerTransactions[0].instructions[4]);

        return innerTransactions[0].instructions;
    } catch (error) {
        console.log("    ERROR :", error);
        return null;
    }
};

export const chekingCreateedToken = async (token: string, wallet: string, connection: Connection) => {
    const mint = new PublicKey(token);

    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        const tokenAccount1 = await getAssociatedTokenAddress(mint, new PublicKey(wallet));
        if (await connection.getAccountInfo(tokenAccount1))
            return true;

        sleep(1000);
    }

    return false;
}