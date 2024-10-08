"use strict";

import { db } from './db.js';
import { Transaction } from './transaction.js';
import { Block } from './block.js';
import { broadcastBlock, broadcastChain, broadcastTransaction } from './p2p.js';
import { acquireLock, releaseLock } from './lock.js';
import { MerkleTree, MerkleProofPath } from './merkleTree.js';
import { createNewWallet, loadWallet } from './wallet.js';
import Decimal from 'decimal.js';

class Blockchain {
  constructor() {
    if (Blockchain.instance) {
      return Blockchain.instance;
    }
    this.chain = [];
    this.difficulty = 2; // Set a realistic difficulty
    this.pendingTransactions = [];
    this.miningReward = 100;
    this.minerAddress = "59a8277a36bffda17f9a997e5f7c23";
    this.genesisAddress = "6c7f05cca415fd2073de8ea8853834";
    this.miningIntervalInSeconds = 30;
    this.transactionPool = new Set();

    this.connectedPeers = [];

    this.isReplacingChain = false;

    Blockchain.instance = this;
  }

  setConnectedPeers(peers) {
    this.connectedPeers = peers;
  }

  async init() {
    await this.initializeGenesisBlock();
    await this.loadChainFromDatabase();
    this.startTimeBasedMining(this.miningIntervalInSeconds);
    this.isSynchronized = true;

    setInterval(async () => {
      const pendingTxCount = await this.countPendingTransactions();
      if (pendingTxCount > 0) {
        await this.minePendingTransactions(this.getMinerAddress());
      }
    }, 10000); // Check every 10 seconds (adjustable)
  }

  async initializeGenesisBlock() {
    const query = "SELECT * FROM blocks WHERE `index` = 0";
    try {
      const [rows] = await db.query(query);
      if (rows.length > 0) {
        const genesisBlock = await Block.load(rows[0].hash);
        if (this.chain.length === 0) {
          this.chain.push(genesisBlock); // Only add to memory if chain is empty
          console.log(`Genesis block loaded with hash: ${genesisBlock.hash}`);
        }
      } else {
        if (this.connectedPeers.length > 0) {
          console.log("Waiting for chain from peers...");
        } else {
          await this.createGenesisBlockWithReward(this.genesisAddress, 1000000);
        }
      }
    } catch (err) {
      console.error("Error initializing genesis block:", err);
      throw err;
    }
  }

  // Create the genesis block with a reward transaction
  async createGenesisBlockWithReward(genesisAddress, initialReward) {
    const rewardTx = new Transaction(null, genesisAddress, initialReward, Date.now(), null, "", null, ""); // Reward transaction
    rewardTx.signature = null; // Reward transactions don't need a signature
  
    console.log("Creating genesis block...");
    const genesisBlock = new Block(
      0,
      null,
      Date.now(),
      [rewardTx],
      this.difficulty
    );
  
    console.log("Mining genesis block...");
    genesisBlock.mineBlock(this.difficulty);
    console.log("Genesis block mined with hash:", genesisBlock.hash);
  
    this.chain.push(genesisBlock);
  
    try {
      console.log("Saving genesis block to the database...");
      await genesisBlock.save();
      console.log(`Genesis block created with initial balance of ${initialReward} to address ${genesisAddress}`);
    } catch (err) {
      console.error("Error saving genesis block:", err);
      throw err;
    }
  }

  // Get the latest block in the blockchain
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  // Start the time-based mining process
  startTimeBasedMining(intervalInSeconds) {
    setInterval(async () => {
      if (this.pendingTransactions.length > 0) {
        await this.minePendingTransactions(this.getMinerAddress());
      }
    }, intervalInSeconds * 1000);
  }

  // Mine pending transactions and add a new block to the blockchain
  async minePendingTransactions(miningRewardAddress) {
    const lockAcquired = await acquireLock("miningLock");
    if (!lockAcquired) {
      return;
    }

    try {
      if (this.pendingTransactions.length === 0) {
        return;
      }

      console.log("Starting to mine a new block...");

      const filteredTransactions = this.pendingTransactions.filter(tx =>
        !this.chain.some(block =>
          block.transactions.some(existingTx => existingTx.hash === tx.hash)
        )
      );

      if (filteredTransactions.length === 0) {
        this.pendingTransactions = [];
        await this.clearPendingTransactions();
        return;
      }

      const uniqueTransactionsMap = new Map();
      filteredTransactions.forEach(tx => {
        if (!uniqueTransactionsMap.has(tx.hash)) {
          uniqueTransactionsMap.set(tx.hash, tx);
        }
      });
      const uniqueTransactions = Array.from(uniqueTransactionsMap.values());

      if (uniqueTransactions.length === 0) {
        this.pendingTransactions = [];
        await this.clearPendingTransactions();
        return;
      }

      const blockTransactions = [...uniqueTransactions];

      if (miningRewardAddress) {
        const rewardTx = new Transaction(
          null, // No sender for mining rewards
          miningRewardAddress,
          this.miningReward
        );
        rewardTx.hash = rewardTx.calculateHash();
        rewardTx.signature = null; // Reward transactions don't need a signature
        blockTransactions.push(rewardTx);
      }
      

      const newBlock = new Block(
        this.chain.length,
        this.getLatestBlock().hash,
        Date.now(),
        blockTransactions,
        this.difficulty
      );

      const previousBlock = this.getLatestBlock();
      const expectedOriginTransactionHash = previousBlock.calculateLastOriginTransactionHash();

      if (previousBlock.originTransactionHash !== expectedOriginTransactionHash) {
        throw new Error('Previous block has an invalid origin transaction hash');
      }

      newBlock.mineBlock(this.difficulty);

      console.log(`Mined block successfully with index: ${newBlock.index}`);
      console.log(`Number of transactions mined in block ${newBlock.index}: ${newBlock.transactions.length}`);

      this.chain.push(newBlock);
      await newBlock.save();

      await this.clearMinedTransactions(newBlock.transactions);

      newBlock.transactions.forEach(tx => {
        this.transactionPool.delete(tx.hash);
      });

      broadcastBlock(newBlock);

      this.pendingTransactions = this.pendingTransactions.filter(tx =>
        !newBlock.transactions.some(newTx => newTx.hash === tx.hash)
      );
    } catch (error) {
      console.error("Error during mining process:", error);
    } finally {
      await releaseLock("miningLock");
    }
  }
  

  async migrateTransactionHashes() {
    const query = "SELECT * FROM transactions";
    try {
      const [transactions] = await db.query(query);
      for (const txData of transactions) {
        const tx = Transaction.fromJSON(txData);
        const newHash = tx.calculateHash();
        if (newHash !== tx.hash) {
          await db.query("UPDATE transactions SET hash = ? WHERE hash = ?", [newHash, tx.hash]);
          console.log(`Updated hash for transaction ${tx.hash} to ${newHash}`);
        }
      }
      console.log("Transaction hash migration complete.");
    } catch (err) {
      console.error("Error migrating transaction hashes:", err);
    }
  }

  async handleReceivedTransaction(tx) {
    if (this.transactionPool.has(tx.hash)) {
      return;
    }

    await this.addPendingTransaction(tx);
  }

  async addBlock(newBlock) {
    const previousBlock = this.getLatestBlock();

    if (newBlock.previousHash !== previousBlock.hash) {
      console.log("Previous hash mismatch. Block rejected.");
      return false;
    }

    if (!await newBlock.hasValidTransactions()) {
      console.log("Block has invalid transactions. Block rejected.");
      return false;
    }

    if (newBlock.hash !== newBlock.calculateHash()) {
      console.log("Invalid block hash. Block rejected.");
      return false;
    }

    if (newBlock.hash.substring(0, this.difficulty) !== Array(this.difficulty + 1).join("0")) {
      console.log("Block does not meet difficulty requirements. Block rejected.");
      return false;
    }

    this.chain.push(newBlock);
    try {
      await newBlock.save();

      await this.clearMinedTransactions(newBlock.transactions);

      this.pendingTransactions = this.pendingTransactions.filter(tx =>
        !newBlock.transactions.some(newTx => newTx.hash === tx.hash)
      );

      broadcastBlock(newBlock);
      return true;
    } catch (err) {
      console.error("Error adding block:", err);
      return false;
    }
  }

  getMinerAddress() {
    return this.minerAddress;
  }

  async addPendingTransaction(transaction) {
    if (!transaction.isValid()) {
      throw new Error("Invalid transaction.");
    }

    if (this.transactionPool.has(transaction.hash)) {
      return;
    }

    this.pendingTransactions.push(transaction);
    this.transactionPool.add(transaction.hash);
    await transaction.savePending();
    broadcastTransaction(transaction);
  }

  calculateCumulativeDifficulty(chainData) {
    return chainData.reduce((total, block) => total + block.difficulty, 0);
  }

  // Replace the current chain with a new chain
  async replaceChain(newChainData) {
    if (this.isReplacingChain) {
      return;
    }

    this.isReplacingChain = true; // Set the flag

    try {
      if (newChainData.length <= this.chain.length) {
        console.log("Received chain is not longer than the current chain. Ignoring.");
        return;
      }

      const isValid = await Blockchain.isValidChain(newChainData);
      if (!isValid) {
        console.log("Received chain is invalid. Ignoring.");
        return;
      }

      const localCumulativeDifficulty = this.calculateCumulativeDifficulty(this.chain.map(block => block.toJSON()));
      const receivedCumulativeDifficulty = this.calculateCumulativeDifficulty(newChainData);

      if (receivedCumulativeDifficulty > localCumulativeDifficulty) {
        try {
          await this.clearLocalBlockchainData();

          this.chain = [];

          for (const blockData of newChainData) {
            const newBlock = Block.fromJSON(blockData);
            await newBlock.save();
            this.chain.push(newBlock);
          }

          this.isSynchronized = true;
          broadcastChain(); // Notify other peers about the updated chain
        } catch (err) {
          console.error("Error replacing chain:", err);
        }
      } else {
        console.log("Received chain does not have higher cumulative difficulty.");
      }
    } finally {
      this.isReplacingChain = false; // Reset the flag
    }
  }

  async clearLocalBlockchainData() {
    try {
      // Delete all transactions
      await db.query("DELETE FROM transactions");

      // Delete all pending transactions
      await db.query("DELETE FROM pending_transactions");

      // Delete all Merkle nodes
      await db.query("DELETE FROM merkle_nodes");

      // Delete all Merkle proof paths
      await db.query("DELETE FROM merkle_proof_paths");

      // Delete all blocks
      await db.query("DELETE FROM blocks");

      // Reset address balances
      await db.query("DELETE FROM address_balances");

      // Reset tokens and token_balances
      await db.query("DELETE FROM token_balances");
      await db.query("DELETE FROM tokens");
    } catch (err) {
      console.error("Error clearing local blockchain data:", err);
      throw err;
    }
  }

  async getBalanceOfAddress(address) {
    // Query to fetch native balance
    const nativeBalanceQuery = `
      SELECT IFNULL(balance, 0) AS native_balance
      FROM address_balances
      WHERE address = ?
    `;
    
    // Query to fetch token balances with symbols using the view
    const tokenBalanceQuery = `
      SELECT token_id, token_symbol, balance
      FROM v_token_balances
      WHERE address = ?
    `;
    
    try {
      // Fetch Native Balance
      const [nativeRows] = await db.query(nativeBalanceQuery, [address]);
      const nativeBalance = nativeRows.length > 0 ? new Decimal(nativeRows[0].native_balance).toFixed(8) : "0.00000000";
      
      // Fetch Token Balances with Symbols
      const [tokenRows] = await db.query(tokenBalanceQuery, [address]);
      
      const tokens = {};
      for (const row of tokenRows) {
        tokens[row.token_id] = {
          token_symbol: row.token_symbol,
          balance: new Decimal(row.balance).toFixed(8)
        };
      }
      
      return {
        native: nativeBalance,
        tokens
      };
    } catch (err) {
      throw err;
    }
  }
  

  // Static method to validate an entire chain
  static async isValidChain(chainData) {
    if (chainData.length === 0) return false;

    const firstBlock = chainData[0];
    if (firstBlock.index !== 0) {
      console.log("Invalid genesis block index.");
      return false;
    }

    if (firstBlock.previous_hash !== null && firstBlock.previous_hash !== '0') {
      console.log("Invalid genesis block previous_hash.");
      return false;
    }

    for (let i = 1; i < chainData.length; i++) {
      const currentBlock = chainData[i];
      const previousBlock = chainData[i - 1];

      if (currentBlock.previous_hash !== previousBlock.hash) {
        console.log(`Block ${currentBlock.index} has invalid previous hash.`);
        return false;
      }

      const tempBlock = Block.fromJSON(currentBlock);
      if (currentBlock.hash !== tempBlock.calculateHash()) {
        console.log(`Block ${currentBlock.index} has invalid hash.`);
        return false;
      }

      if (currentBlock.hash.substring(0, currentBlock.difficulty) !== Array(currentBlock.difficulty + 1).join("0")) {
        console.log(`Block ${currentBlock.index} does not meet difficulty requirements.`);
        return false;
      }

      const isValidTransactions = await tempBlock.hasValidTransactions();
      if (!isValidTransactions) {
        console.log(`Block ${currentBlock.index} contains invalid transactions.`);
        return false;
      }
    }

    return true; // All blocks are valid
  }

  /**
   * Verify if a transaction is in the specified block
   * @param {string} transactionHash - The hash of the transaction to verify
   * @param {string} blockHash - The hash of the block where the transaction should be
   * @returns {boolean} - Returns true if the transaction is in the specified block, otherwise false
   */
  async verifyTransactionInBlock(transactionHash, blockHash) {
    try {
      const block = this.chain.find(b => b.hash === blockHash);
      if (!block) {
        console.log("Block not found in local blockchain.");
        return false;
      }

      const proofPath = await MerkleProofPath.getProofPath(transactionHash);
      if (!proofPath) {
        console.log("Proof not found in the database.");
        return false;
      }

      const isValid = MerkleTree.verifyProof(transactionHash, proofPath, block.merkleRoot);
      return isValid;
    } catch (error) {
      console.error("Error verifying transaction:", error);
      return false;
    }
  }

  // Load the blockchain from the database
  async loadChainFromDatabase() {
    const query = "SELECT * FROM blocks ORDER BY `index` ASC";
    try {
      this.chain = [];

      const [rows, fields] = await db.query(query);
      for (const result of rows) {
        const block = await Block.load(result.hash);
        if (block) {
          this.chain.push(block);
        }
      }

      if (this.chain.length === 0) {
        if (this.connectedPeers.length > 0) {
          return;
        } else {
          console.log("No blocks in DB and no peers connected. Creating genesis block...");
          await this.createGenesisBlockWithReward(this.genesisAddress, 1000000);
        }
      }

      if (!await this.isChainValid()) {
        throw new Error("Blockchain is invalid after loading from database.");
      } else {
        console.log("Blockchain loaded and validated successfully.");
      }
    } catch (err) {
      console.error("Error loading blockchain from database:", err);
      throw err;
    }
  }

  async countPendingTransactions() {
    const query = "SELECT COUNT(*) AS count FROM pending_transactions";
    try {
      const [rows, fields] = await db.query(query);
      return rows[0].count;
    } catch (err) {
      throw err;
    }
  }

  // Clear pending transactions from the database
  async clearPendingTransactions() {
    const query = "DELETE FROM pending_transactions";
    try {
      await db.query(query);
    } catch (err) {
      console.error("Error clearing pending transactions:", err);
      throw err;
    }
  }

  async clearMinedTransactions(minedTransactions) {
    const transactionHashes = minedTransactions.map(tx => tx.hash);
    if (transactionHashes.length === 0) return;

    const placeholders = transactionHashes.map(() => '?').join(', ');
    const query = `DELETE FROM pending_transactions WHERE hash IN (${placeholders})`;
    try {
      await db.query(query, transactionHashes);
    } catch (err) {
      console.error("Error clearing mined transactions from the database:", err);
      throw err;
    }
  }

  async validateDatabaseState() {
    const transactions = await this.getAllTransactions();
    const calculatedBalances = {};

    for (const tx of transactions) {
      if (tx.fromAddress) {
        if (!calculatedBalances[tx.fromAddress]) calculatedBalances[tx.fromAddress] = new Decimal(0);
        calculatedBalances[tx.fromAddress] = calculatedBalances[tx.fromAddress].minus(tx.amount);
      }

      if (tx.toAddress) {
        if (!calculatedBalances[tx.toAddress]) calculatedBalances[tx.toAddress] = new Decimal(0);
        calculatedBalances[tx.toAddress] = calculatedBalances[tx.toAddress].plus(tx.amount);
      }
    }

    for (const [address, balance] of Object.entries(calculatedBalances)) {
      if (address === "null") {
        const nullAddressBalance = await this.getBalanceOfAddress("null");
        if (new Decimal(nullAddressBalance).toFixed(8) !== "0.00000000") {
          console.error(`Balance mismatch for null address: expected 0.00000000, found ${nullAddressBalance}`);
          return false;
        }
        continue;
      }

      const dbBalance = await this.getBalanceOfAddress(address);

      if (!balance.equals(new Decimal(dbBalance))) {
        console.error(`Balance mismatch for address ${address}: expected ${balance.toFixed(8)}, found ${dbBalance}`);

        const discrepancyTransactions = transactions.filter(
          (tx) => tx.fromAddress === address || tx.toAddress === address
        );

        console.log(`Discrepancy caused by transactions involving address ${address}:`);

        discrepancyTransactions.forEach((tx) => {
          console.log(
            `Transaction found in Block ${tx.blockIndex}:
            From: ${tx.fromAddress}
            To: ${tx.toAddress}
            Amount: ${tx.amount}
            Timestamp: ${new Date(tx.timestamp).toLocaleString()}
            Hash: ${tx.hash}
            Origin Transaction Hash: ${tx.originTransactionHash}`
          );
        });

        return false;
      }
    }
    return true;
  }

  async getAllTransactions() {
    const query = "SELECT * FROM transactions";
    try {
      const [rows, fields] = await db.query(query);
      return rows.map(result => new Transaction(
        result.from_address,
        result.to_address,
        result.amount,
        result.timestamp,
        result.signature,
        result.block_hash,
        result.origin_transaction_hash,
        result.public_key
      ));
    } catch (err) {
      console.error("Error fetching all transactions:", err);
      throw err;
    }
  }

  async isChainValid() {
    const chainData = this.chain.map(block => block.toJSON());
    return await Blockchain.isValidChain(chainData);
  }

  /**
   * Create a new token
   * @param {string} name - Name of the token
   * @param {string} symbol - Symbol of the token
   * @param {number} totalSupply - Total supply of the token
   * @param {string} creatorAddress - Address of the token creator
   * @returns {object} - Created token details
   */
  async createToken(name, symbol, totalSupply, creatorAddress) {
    // Check if symbol already exists
    const symbolCheckQuery = "SELECT * FROM tokens WHERE symbol = ?";
    const [existingTokens] = await db.query(symbolCheckQuery, [symbol]);
    if (existingTokens.length > 0) {
      throw new Error("Token symbol already exists.");
    }
  
    // Ensure the creatorAddress exists in address_balances
    const insertAddressQuery = `
      INSERT INTO address_balances (address, balance)
      VALUES (?, 0.00000000)
      ON DUPLICATE KEY UPDATE balance = balance
    `;
    await db.query(insertAddressQuery, [creatorAddress]);
  
    // Insert new token
    const insertTokenQuery = `
      INSERT INTO tokens (name, symbol, total_supply, creator_address, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `;
    const timestamp = Date.now();
    const [tokenResult] = await db.query(insertTokenQuery, [name, symbol, totalSupply, creatorAddress, timestamp]);
  
    const tokenId = tokenResult.insertId;
  
    // Create a transaction for token creation as a reward transaction
    const tx = new Transaction(null, creatorAddress, totalSupply, timestamp, null, "", null, "");
    tx.tokenId = tokenId;
    tx.tokenName = name; // Assign the token name
    tx.tokenSymbol = symbol; // Assign the token symbol
    tx.tokenTotalSupply = totalSupply; 
    tx.signature = null; // Reward transactions don't require a signature

    // Explicitly recalculate hash
    tx.hash = tx.calculateHash();
  
    await this.addPendingTransaction(tx);
  
    return {
      token_id: tokenId,
      name,
      symbol,
      total_supply: totalSupply,
      creator_address: creatorAddress,
      timestamp
    };
  }

  /**
   * Transfer tokens from one address to another
   * @param {string} fromAddress - Sender's address
   * @param {string} toAddress - Receiver's address
   * @param {number} amount - Amount to transfer
   * @param {number} tokenId - ID of the token to transfer
   */
  async transferToken(fromAddress, toAddress, amount, tokenId) {
  // Check if sender has enough tokens
  const balanceQuery = "SELECT balance FROM token_balances WHERE address = ? AND token_id = ?";
  const [balanceRows] = await db.query(balanceQuery, [fromAddress, tokenId]);

  if (balanceRows.length === 0 || new Decimal(balanceRows[0].balance).lessThan(amount)) {
    throw new Error("Insufficient token balance.");
  }

  // Ensure the receiver's address exists in address_balances
  const insertToAddressQuery = `
    INSERT INTO address_balances (address, balance)
    VALUES (?, 0.00000000)
    ON DUPLICATE KEY UPDATE balance = balance
  `;
  await db.query(insertToAddressQuery, [toAddress]);

  // Retrieve the latest transaction for originTransactionHash
  const latestTransaction = await Transaction.getLatestTransactionForAddress(fromAddress);
  const originTransactionHash = latestTransaction ? latestTransaction.hash : null;

  // Create a transaction for token transfer
  const tx = new Transaction(fromAddress, toAddress, amount, Date.now(), null, null, originTransactionHash, '', null, tokenId);
  
  await tx.signWithAddress(fromAddress);
  await this.addPendingTransaction(tx);
}
}

// Instantiate the Blockchain
const blockchainInstance = new Blockchain();

// Bind createToken and transferToken to the instance
const createToken = blockchainInstance.createToken.bind(blockchainInstance);
const transferToken = blockchainInstance.transferToken.bind(blockchainInstance);

export {
  blockchainInstance,
  Blockchain,
  Transaction,
  Block,
  createToken,
  transferToken,
};
