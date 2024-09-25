import readline from 'readline';
import { blockchainInstance, Transaction } from './src/blockchain.js'; // Adjust based on your exports
import { createNewWallet, loadWallet, ec } from './src/wallet.js';
import { MerkleTree, MerkleProofPath, Node } from './src/merkleTree.js';
import { db } from './src/db.js';
import crypto from 'crypto';
import util from 'util';
import Decimal from 'decimal.js';
import { initP2PServer, broadcastBlock, broadcastChain, broadcastTransaction } from './src/p2p.js';

//const queryAsync = util.promisify(db.query).bind(db);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("Blockchain CLI is starting...");

  try {

    console.log("Initializing P2P server...");
    // Initialize the P2P server with the blockchain instance
    initP2PServer(blockchainInstance);
    console.log("P2P server initialized.");

    console.log("Initializing blockchain...");
    // Initialize the blockchain
    await blockchainInstance.init();
    console.log("Blockchain initialized.");

    console.log("Starting automatic mining...");
    // Start automatic mining using the interval defined in the Blockchain class
    blockchainInstance.startTimeBasedMining(blockchainInstance.miningIntervalInSeconds);
    console.log("Automatic mining started.");
  } catch (error) {
    console.error("Error during initialization:", error.message);
    rl.close();
    return;
  }

  console.log("Entering main menu...");

  while (true) {
    console.log(`
    1. Create a new wallet
    2. Send a transaction
    3. View blockchain
    4. Check balance of address
    5. View transactions for address
    6. Trace a transaction
    7. Trace fund movement 
    8. Run transaction test 
    9. Validate blockchain
    10. Verify Merkle proof by transaction hash 
    11. Exit
    `);

    const choice = await askQuestion("Select an option: ");

    switch (choice) {
      case "1":
        createNewWallet();
        break;
      case "2":
        await sendTransaction();
        break;
      case "3":
        await viewBlockchain();
        break;
      case "4":
        await checkBalance();
        break;
      case "5":
        await viewTransactionsForAddress();
        break;
      case "6":
        await traceTransaction();
        break;
      case "7":
        await traceFundMovement();
        break;
      case "8":
        await runTransactionAndMiningTest();
        break;
      case "9":
        await validateBlockchain();
        break;
      case "10":
        await verifyMerkleProofByTransactionHash();
        break;
      case "11":
        console.log("Exiting...");
        rl.close();
        return;
      default:
        console.log("Invalid option. Please try again.");
    }
  }
}

async function sendTransaction() {
  try {
    console.log("Starting transaction submission process...");
    if (!(await blockchainInstance.isChainValid())) {
      console.log("Blockchain is invalid. Transaction cannot proceed.");
      return;
    }

    console.log("Blockchain is valid. Proceeding with transaction.");

    const fromAddress = await askQuestion("Enter your wallet address: ");

    if (!fromAddress || fromAddress.length < 24 || fromAddress.length > 30) {
      console.log("Invalid wallet address.");
      return;
    }

    let wallet;
    try {
      wallet = loadWallet(fromAddress);
      console.log("Wallet loaded successfully.");
    } catch (error) {
      console.log("Wallet not found.");
      return;
    }

    const privateKey = await askQuestion("Enter your private key: ");
    console.log("Private key entered.");

    if (!privateKey || privateKey.length !== 64) {
      console.log("Invalid private key.");
      return;
    }

    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');
    const derivedAddress = crypto.createHash('sha256').update(Buffer.from(publicKey, 'hex')).digest('hex').slice(0, 30);

    if (derivedAddress !== fromAddress) {
      console.log("Private key does not correspond to the provided address.");
      return;
    }

    console.log("Private key validated successfully.");

    const toAddress = await askQuestion("Enter the recipient address: ");
    console.log("Recipient address entered.");

    if (!toAddress || toAddress.length < 24 || toAddress.length > 30) {
      console.log("Invalid wallet address.");
      return;
    }

    const amountInput = await askQuestion("Enter the amount to send: ");
    console.log(`Amount entered: ${amountInput}`);

    const amount = parseFloat(amountInput);

    if (isNaN(amount) || amount <= 0) {
      console.log("Invalid amount.");
      return;
    }

    console.log("Fetching sender's balance...");
    const senderBalance = await blockchainInstance.getBalanceOfAddress(fromAddress);
    console.log(`Sender's balance: ${senderBalance}`);

    if (new Decimal(senderBalance).lessThan(amount)) {
      console.log("Insufficient funds in the wallet.");
      return;
    }

    const latestTransaction = await Transaction.getLatestTransactionForAddress(fromAddress);
    const originTransactionHash = latestTransaction ? latestTransaction.hash : null;

    console.log("Creating new transaction...");
    const tx = new Transaction(fromAddress, toAddress, amount, Date.now(), null, "", originTransactionHash);
    await tx.signWithAddress(fromAddress); // This now includes publicKey
    console.log("Transaction signed successfully.");

    console.log("Adding pending transaction...");
    await blockchainInstance.addPendingTransaction(tx);
    console.log("Transaction submitted successfully.");
  } catch (error) {
    console.error("Error in sendTransaction:", error);
  }
}

async function viewBlockchain() {
  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot view blockchain.");
    return;
  }

  const blocks = blockchainInstance.chain;
  console.log(`Total blocks: ${blocks.length}`);
  blocks.forEach((block) => {
    console.log(`Block ${block.index}: ${block.transactions.length} transactions, Hash: ${block.hash}`);
  });
}

async function checkBalance() {
  const address = await askQuestion("Enter the address to check balance: ");

  if (!address || address.length < 24 || address.length > 30) {
    console.log("Invalid wallet address.");
    return;
  }

  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot fetch balance.");
    return;
  }

  try {
    const balance = await blockchainInstance.getBalanceOfAddress(address);
    console.log(`Balance of address ${address}: ${balance}`);
  } catch (error) {
    console.error("Error fetching balance:", error);
  }
}

async function viewTransactionsForAddress() {
  const address = await askQuestion("Enter the address to view transactions: ");

  if (!address || address.length < 24 || address.length > 30) {
    console.log("Invalid wallet address.");
    return;
  }

  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot view transactions.");
    return;
  }

  const allTransactions = [];

  blockchainInstance.chain.forEach((block) => {
    block.transactions.forEach((transaction) => {
      if (transaction.fromAddress === address || transaction.toAddress === address) {
        allTransactions.push(transaction);
      }
    });
  });

  if (allTransactions.length === 0) {
    console.log(`No transactions found for address ${address}`);
  } else {
    console.log(`Transactions for address ${address}:`);
    allTransactions.forEach((transaction, index) => {
      console.log(`
        Transaction ${index + 1}:
        From: ${transaction.fromAddress}
        To: ${transaction.toAddress}
        Amount: ${transaction.amount}
        Timestamp: ${new Date(transaction.timestamp).toLocaleString()}
        Hash: ${transaction.hash}
        Public Key: ${transaction.publicKey}
      `);
    });
  }
}

async function traceTransaction() {
  const transactionHash = await askQuestion("Enter the transaction hash to trace: ");

  if (!transactionHash || transactionHash.length !== 64) {
    console.log("Invalid transaction hash.");
    return;
  }

  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot trace transaction.");
    return;
  }

  let foundTransaction = null;
  let blockIndex = null;

  blockchainInstance.chain.forEach((block, index) => {
    block.transactions.forEach((transaction) => {
      if (transaction.hash === transactionHash) {
        foundTransaction = transaction;
        blockIndex = index;
      }
    });
  });

  if (foundTransaction) {
    console.log(`
      Transaction found in Block ${blockIndex}:
      From: ${foundTransaction.fromAddress}
      To: ${foundTransaction.toAddress}
      Amount: ${foundTransaction.amount}
      Timestamp: ${new Date(foundTransaction.timestamp).toLocaleString()}
      Hash: ${foundTransaction.hash}
      Origin Transaction Hash: ${foundTransaction.originTransactionHash}
      Public Key: ${foundTransaction.publicKey}
    `);
  } else {
    console.log(`Transaction with hash ${transactionHash} not found.`);
  }
}

async function traceFundMovement() {
  const transactionHash = await askQuestion("Enter the transaction hash to trace fund movement: ");

  if (!transactionHash || transactionHash.length !== 64) {
    console.log("Invalid transaction hash.");
    return;
  }

  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot trace fund movement.");
    return;
  }

  let currentTransaction = null;
  let blockIndex = null;

  for (let i = 0; i < blockchainInstance.chain.length; i++) {
    const block = blockchainInstance.chain[i];
    for (let j = 0; j < block.transactions.length; j++) {
      if (block.transactions[j].hash === transactionHash) {
        currentTransaction = block.transactions[j];
        blockIndex = i;
        break;
      }
    }
    if (currentTransaction) break;
  }

  if (!currentTransaction) {
    console.log(`Transaction with hash ${transactionHash} not found.`);
    return;
  }

  console.log(`Tracing fund movement starting from transaction in Block ${blockIndex}...`);
  displayTransactionDetails(currentTransaction, blockIndex);

  while (currentTransaction.originTransactionHash) {
    const originHash = currentTransaction.originTransactionHash;
    currentTransaction = null;

    for (let i = 0; i < blockchainInstance.chain.length; i++) {
      const block = blockchainInstance.chain[i];
      for (let j = 0; j < block.transactions.length; j++) {
        if (block.transactions[j].hash === originHash) {
          currentTransaction = block.transactions[j];
          blockIndex = i;
          break;
        }
      }
      if (currentTransaction) break;
    }

    if (currentTransaction) {
      displayTransactionDetails(currentTransaction, blockIndex);
    } else {
      console.log(`Reached the end of the transaction chain. No further origin transactions found.`);
      break;
    }
  }
}

function displayTransactionDetails(transaction, blockIndex) {
  console.log(`
    Transaction found in Block ${blockIndex}:
    From: ${transaction.fromAddress}
    To: ${transaction.toAddress}
    Amount: ${transaction.amount}
    Timestamp: ${new Date(transaction.timestamp).toLocaleString()}
    Hash: ${transaction.hash}
    Previous Transaction Hash: ${transaction.originTransactionHash}
    Public Key: ${transaction.publicKey} 
  `);
}

async function runTransactionAndMiningTest() {
  console.log("Running transaction test...");

  if (!blockchainInstance.isChainValid()) {
    console.log("Blockchain is invalid. Cannot run the test.");
    return;
  }

  let previousTransactionHash = null;
  const wallets = [];
  let transactionCount = 0;

  // Create two wallets for testing
  for (let i = 0; i < 2; i++) {
    const wallet = createNewWallet();
    wallets.push(wallet);
  }

  const genesisRewardAddress = blockchainInstance.genesisAddress;

  for (let i = 0; i < 12; i++) {
    const toWallet = wallets[i % 2];
    const fromAddress = genesisRewardAddress;
    const toAddress = toWallet.address;
    const amount = 10;
    const timestamp = Date.now();

    const tx = new Transaction(fromAddress, toAddress, amount, timestamp, null, '', previousTransactionHash);
    await tx.signWithAddress(fromAddress); // This now includes publicKey
    await blockchainInstance.addPendingTransaction(tx);
    previousTransactionHash = tx.hash;
    transactionCount++;
  }

  console.log(`Test complete. Total transactions done: ${transactionCount}`);
}

async function validateBlockchain() {
  const GENESIS_BLOCK_INDEX = 0;
  let validatedBlocksCount = 0;
  let validatedTransactionsCount = 0;

  try {
    for (let i = 0; i < blockchainInstance.chain.length; i++) {
      const block = blockchainInstance.chain[i];

      // Validate block integrity
      const isBlockValid = await blockchainInstance.constructor.isValidChain(blockchainInstance.chain.slice(0, i + 1).map(b => b.toJSON()));
      if (!isBlockValid) {
        console.log(`Block ${i} is invalid.`);
        return;
      }

      for (const transaction of block.transactions) {
        const isGenesisBlock = i === GENESIS_BLOCK_INDEX;
        const isValid = await validateTransaction(transaction, i, isGenesisBlock);

        if (!isValid) {
          console.log(`Invalid transaction ${transaction.hash} in block ${i}.`);
          return;
        }

        validatedTransactionsCount++;
      }

      validatedBlocksCount++;
    }

    const allAddresses = getAllAddressesFromBlockchain();

    for (const address of allAddresses) {
      const balance = await blockchainInstance.getBalanceOfAddress(address);
      if (new Decimal(balance).isNegative()) {
        console.log(`Negative balance found for address ${address}.`);
        return;
      }
    }

    console.log("Blockchain validation passed. All transactions and balances are correct.");
    console.log(`Total blocks verified: ${validatedBlocksCount}`);
    console.log(`Total transactions verified: ${validatedTransactionsCount}`);
  } catch (error) {
    console.error("Error validating blockchain:", error);
  }
}

function isHexString(str) {
  return typeof str === 'string' && /^[0-9a-fA-F]+$/.test(str);
}

async function validateTransaction(transaction, blockIndex, isGenesis = false) {
  const GENESIS_ADDRESS = '6c7f05cca415fd2073de8ea8853834';
  const isMiningReward = transaction === blockchainInstance.chain[blockIndex].transactions[blockchainInstance.chain[blockIndex].transactions.length - 1];

  if (isGenesis || transaction.fromAddress === GENESIS_ADDRESS || isMiningReward) {
    return true;
  }

  if (!transaction.signature) {
    console.log(`No signature found for transaction ${transaction.hash}`);
    return false;
  }

  const transactionHash = transaction.calculateHash();
  if (transactionHash !== transaction.hash) {
    console.log(`Hash mismatch for transaction ${transaction.hash}`);
    return false;
  }

  try {
    console.log(`Verifying transaction from address: ${transaction.fromAddress}`);

    // Validate the publicKey field
    if (!transaction.publicKey || (transaction.publicKey.length !== 66 && transaction.publicKey.length !== 130)) {
      console.error(`Invalid public key length for transaction ${transaction.hash}`);
      return false;
    }

    if (!isHexString(transaction.publicKey)) {
      console.error(`Invalid public key format for transaction ${transaction.hash}`);
      return false;
    }

    // Derive the address from the publicKey and verify it matches fromAddress
    const derivedAddress = crypto.createHash('sha256').update(Buffer.from(transaction.publicKey, 'hex')).digest('hex').slice(0, 30);
    if (derivedAddress !== transaction.fromAddress) {
      console.error(`Derived address from public key does not match fromAddress for transaction ${transaction.hash}`);
      return false;
    }

    // Use the publicKey for signature verification
    const keyPair = ec.keyFromPublic(transaction.publicKey, 'hex');
    const signatureIsValid = keyPair.verify(transaction.hash, transaction.signature);
    if (!signatureIsValid) {
      console.log(`Signature verification failed for transaction ${transaction.hash}`);
      return false;
    }
  } catch (error) {
    console.error(`Error verifying signature for transaction ${transaction.hash}:`, error);
    return false;
  }

  return true;
}

function getAllAddressesFromBlockchain() {
  const addresses = new Set();
  blockchainInstance.chain.forEach(block => {
    block.transactions.forEach(transaction => {
      if (transaction.fromAddress) addresses.add(transaction.fromAddress);
      if (transaction.toAddress) addresses.add(transaction.toAddress);
    });
  });
  return Array.from(addresses);
}

async function verifyMerkleProofByTransactionHash() {
  const transactionHash = await askQuestion("Enter the transaction hash: ");

  try {
    // Retrieve the block hash associated with the transaction hash
    const blockHashQuery = "SELECT block_hash FROM transactions WHERE hash = ?";
    const [result] = await db.query(blockHashQuery, [transactionHash]);

    if (result.length === 0) {
      console.log("Transaction not found in the blockchain.");
      return;
    }

    const blockHash = result[0].block_hash;
    console.log(`Block hash containing the transaction: ${blockHash}`);

    // Retrieve the Merkle proof path
    const proofPath = await MerkleProofPath.getProofPath(transactionHash);

    if (!proofPath) {
      console.log("No proof path found for the given transaction.");
      return;
    }

    // Retrieve the Merkle root from the block
    const blockQuery = "SELECT merkle_root FROM blocks WHERE hash = ?";
    const [blockResult] = await db.query(blockQuery, [blockHash]);

    if (blockResult.length === 0) {
      console.log("Block not found in the blockchain.");
      return;
    }

    const merkleRoot = blockResult[0].merkle_root;

    // Initialize the hash with the transaction hash
    let currentHash = transactionHash;
    console.log("Initial leaf hash:", currentHash);

    // Iterate through each step in the proof path
    proofPath.forEach((step, index) => {
      const { siblingHash, direction } = step;
      let parentHash;

      if (direction === 'left') {
        parentHash = Node.hash(currentHash + siblingHash);
      } else if (direction === 'right') {
        parentHash = Node.hash(siblingHash + currentHash);
      } else {
        throw new Error(`Invalid direction '${direction}' in proof path.`);
      }

      console.log(`Step ${index + 1}:`);
      console.log(`Sibling hash: ${siblingHash}`);
      console.log(`Parent hash: ${parentHash}`);
      console.log(`  Direction: ${direction}`);

      // Update the current hash to the parent hash for the next iteration
      currentHash = parentHash;
    });

    console.log("Expected root hash:", merkleRoot);

    // Final verification
    if (currentHash === merkleRoot) {
      console.log("Merkle proof is valid.");
    } else {
      console.log("Merkle proof is invalid.");
    }
  } catch (err) {
    console.error("Error verifying Merkle proof:", err);
  }
}



main().catch(console.error);