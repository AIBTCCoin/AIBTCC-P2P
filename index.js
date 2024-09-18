'use strict';

const { Blockchain, Transaction } = require('./src/blockchain');
const { Node, MerkleTree } = require('./src/merkleTree');
const EC = require('elliptic').ec;
const { createKeypair, SolanaTransaction, requestAirdrop, LAMPORTS_PER_SOL } = require('./solana');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command-line arguments
const argv = yargs(hideBin(process.argv)).argv;

// Debug: Print parsed arguments
console.log('Parsed arguments:', argv);

// Create a new elliptic curve instance using the secp256k1 curve
const ec = new EC('secp256k1');

// Generate a new key pair (private and public key)
const keyPair = ec.genKeyPair();
const privateKey = keyPair.getPrivate('hex'); // Extract the private key in hexadecimal format
const publicKey = keyPair.getPublic('hex'); // Extract the public key in hexadecimal format

// Print the generated public and private keys to the console
console.log('Public Key:', publicKey);
console.log('Private Key:', privateKey);

// Example values to build the Merkle Tree
const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

if (values.length === 0) {
    console.error("Error: No values provided to build the Merkle Tree.");
    process.exit(1);
}

const merkleTree = new MerkleTree(values);
merkleTree.printTree();
console.log('Merkle Tree Root Hash:', merkleTree.getRootHash());

// Create a new instance of the Blockchain class
const myCoin = new Blockchain();

// Log the initial state of the blockchain
console.log("Initial Blockchain State:");
console.log(JSON.stringify(myCoin, null, 2));

// Async function to create and mine transactions
(async () => {
  try {
    await myCoin.addInitialBalance(publicKey, 100);
    // Mine the initial transactions to confirm the balance
    await myCoin.minePendingTransactions(publicKey);
    console.log('Initial mining complete!');

    // Log the state of the blockchain after initial mining
    console.log("Blockchain After Initial Mining:");
    console.log(JSON.stringify(myCoin, null, 2));

    // Create a new transaction from the public key address to 'address2' with amount 100
    const tx1 = new Transaction(publicKey, 'address2', 100);
    
    // Sign the transaction with the private key
    tx1.sign(ec.keyFromPrivate(privateKey));

    console.log('Signing Transaction');
    console.log('Transaction Validity Before Adding:', tx1.isValid());
    console.log('Transaction Details:', tx1);
    
    myCoin.addTransaction(tx1);

    console.log('New Transaction - From Address:', tx1.fromAddress);
    console.log('New Transaction - To Address:', tx1.toAddress);

    // Mine the new transactions
    await myCoin.minePendingTransactions('miner-address');
    console.log('Mining complete!');

    // Log the state of the blockchain after mining the new transactions
    console.log("Blockchain After Mining New Transactions:");
    console.log(JSON.stringify(myCoin, null, 2));

    // Print the balance of the public key address
    const balancePublicKey = myCoin.getBalanceOfAddress(publicKey);
    const balanceAddress2 = myCoin.getBalanceOfAddress('address2');
    console.log(`Balance of public key: ${balancePublicKey}`);
    console.log(`Balance of address2: ${balanceAddress2}`);

    // Validate the blockchain to ensure its integrity
    const isValid = await myCoin.isChainValid();
    console.log(`Blockchain valid: ${isValid}`);

    // Solana transaction code integration
    /*
    const fromKeypair = createKeypair();
    const toPublicKey = '3i6kD6Wpgd3A7ZqAmjrcZ9mMxv9az6k7EATtUV5NsDoB'; // Replace with actual recipient public key

    const solanaTransaction = new SolanaTransaction(fromKeypair.publicKey.toString(), toPublicKey, 0.000000001); // 1 SOL
    await solanaTransaction.executeSolanaTransaction(fromKeypair, toPublicKey, argv.airdrop);
    */
  } catch (error) {
    // Catch and log any errors that occur during the process
    console.error('Error:', error);
  }
})();















