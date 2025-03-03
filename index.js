const { Keypair } = require("@solana/web3.js");
const bs58 = require('bs58');

async function main() {
    let count = 0;

    const PRIVATE_KEY = [250,96,100,151,209,203,205,24,175,103,244,193,106,177,171,54,148,38,245,180,187,33,54,33,164,91,98,191,155,139,157,7,208,138,177,87,14,31,229,177,54,32,211,142,247,176,245,9,209,27,206,188,234,243,225,243,255,169,239,9,44,128,183,139];
    console.log("Len=", PRIVATE_KEY.length, "Priv=", bs58.encode(PRIVATE_KEY));

    const ZOMBIE_KEY = [209,100,24,73,97,239,255,35,146,17,25,71,248,161,168,68,155,172,129,66,94,28,232,131,201,121,170,42,198,96,241,35,206,92,249,174,193,171,111,102,207,14,187,116,255,114,89,68,245,60,76,255,175,212,80,138,220,61,129,228,162,113,201,70];
    console.log("Zombie=", bs58.encode(ZOMBIE_KEY));

    const REGISTERED_WALLET = [127,246,135,89,115,69,128,50,253,82,195,219,199,102,9,141,19,161,68,163,122,175,214,220,6,72,234,148,41,8,199,100,123,2,123,172,160,220,143,232,105,194,213,202,204,242,6,99,60,56,219,79,128,90,101,126,59,212,158,112,13,149,89,11];
    console.log("Registered Wallet=", bs58.encode(REGISTERED_WALLET));
    
    let startTime = process.hrtime();
    let endTime = process.hrtime(startTime);

    while (true) {
        const keypair = new Keypair();
        const address = keypair.publicKey.toBase58();
        count++;
        if (address.endsWith("pump")) {
            console.log("address:", address);
            console.log("PrivateKey:", bs58.encode(keypair.secretKey));
            const endTime = process.hrtime(startTime);
            console.log(`Execution time: ${endTime[0]}s ${endTime[1]/1000000}ms`);
            startTime = process.hrtime();
            break;
        }
        
        if (count % 10000 == 0) {
            const endTime = process.hrtime(startTime);
            console.log("count=", count);
            console.log(`Execution time: ${endTime[0]}s ${endTime[1]/1000000}ms`);
        }
    }
}

main();

