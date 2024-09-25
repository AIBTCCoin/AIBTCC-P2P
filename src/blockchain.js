"use strict";

import { db } from './db.js';
import { Transaction } from './transaction.js';
import { Block } from './block.js';
import { broadcastBlock, broadcastChain, broadcastTransaction } from './p2p.js';
import { acquireLock, releaseLock } from './lock.js';
import { MerkleTree, MerkleProofPath } from './merkleTree.js';
import { createNewWallet, loadWallet } from './wallet.js';


import Decimal from'decimal.js';

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
    console.log("Checking for existing genesis block...");
    const query = "SELECT * FROM blocks WHERE `index` = 0";
    
    try {
        const [rows] = await db.query(query);
        
        if (rows.length > 0) {
            const genesisBlock = await Block.load(rows[0].hash);
            if (this.chain.length === 0) {
                this.chain.push(genesisBlock); // Only add to memory if chain is empty
            }
        } else {
            const genesisBlock = await this.fetchGenesisBlockFromPeers();
  
            if (genesisBlock) {
                this.chain.push(genesisBlock);
                await genesisBlock.save();
            } else {
                await this.createGenesisBlockWithReward(this.genesisAddress, 1000000);
            }
        }
    } catch (err) {
        console.error("Error initializing genesis block:", err);
        throw err;
    }
  }




  async fetchGenesisBlockFromPeers() {
    if (!this.connectedPeers || this.connectedPeers.length === 0) {
        return null;
    }

    // Create a promise that waits for the genesis block to be received
    return new Promise((resolve, reject) => {
        let genesisBlockReceived = false;

        // Set up a timeout in case the peers do not respond in time
        const timeout = setTimeout(() => {
            if (!genesisBlockReceived) {
                reject(new Error("Timeout: No genesis block received from peers."));
            }
        }, 5000); // 5-second timeout, adjust as needed

        // Send a request to all connected peers
        this.connectedPeers.forEach((peer) => {
            peer.send(JSON.stringify({
                type: 'REQUEST_GENESIS_BLOCK'
            }));

            // Listen for incoming messages
            peer.on('message', (data) => {
                const message = JSON.parse(data);
                if (message.type === 'GENESIS_BLOCK' && !genesisBlockReceived) {
                    genesisBlockReceived = true;
                    clearTimeout(timeout); // Clear the timeout when a response is received
                    const genesisBlock = Block.fromJSON(message.data);
                    resolve(genesisBlock); // Resolve with the genesis block
                }
            });
        });
    });
}



  // Create the genesis block with a reward transaction
  async createGenesisBlockWithReward(genesisAddress, initialReward) {
    const rewardTx = new Transaction(null, genesisAddress, initialReward); // Reward transaction
    rewardTx.hash = rewardTx.calculateHash();
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
    // Attempt to acquire a lock before starting mining to prevent concurrent mining
    const lockAcquired = await acquireLock("miningLock");
    if (!lockAcquired) {
      
      return;
    }

    try {
      if (this.pendingTransactions.length === 0) {
        return;
      }

      console.log("Starting to mine a new block...");

      // **Step 1: Filter Out Transactions Already in the Chain**
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

      // **Step 2: Ensure Uniqueness of Transactions by Their Hash**
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

      // **Step 3: Prepare Transactions for the New Block**
      const blockTransactions = [...uniqueTransactions];

      // **Step 4: Add Mining Reward Transaction**
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

      // **Step 5: Create a New Block with the Collected Transactions**
      const newBlock = new Block(
        this.chain.length,
        this.getLatestBlock().hash,
        Date.now(),
        blockTransactions,
        this.difficulty
      );

      // **Step 6: Validate Origin Transaction Hash**
      const previousBlock = this.getLatestBlock();
      const expectedOriginTransactionHash = previousBlock.calculateLastOriginTransactionHash();

      if (previousBlock.originTransactionHash !== expectedOriginTransactionHash) {
        throw new Error('Previous block has an invalid origin transaction hash');
      }

      // **Step 7: Mine the New Block**
      newBlock.mineBlock(this.difficulty);

      console.log(`Mined block successfully with index: ${newBlock.index}`);
      console.log(`Number of transactions mined in block ${newBlock.index}: ${newBlock.transactions.length}`);

      // **Step 8: Add the New Block to the Chain and Save It**
      this.chain.push(newBlock);
      await newBlock.save();

      // **Step 9: Clear Mined Transactions from Pending and the Transaction Pool**
      await this.clearMinedTransactions(newBlock.transactions);
      newBlock.transactions.forEach(tx => {
        this.transactionPool.delete(tx.hash);
      });

      // **Step 10: Broadcast the New Block to Peers**
      broadcastBlock(newBlock);

      // **Step 11: Remove Mined Transactions from the In-Memory Pending List**
      this.pendingTransactions = this.pendingTransactions.filter(tx => 
        !newBlock.transactions.some(newTx => newTx.hash === tx.hash)
      );
    } catch (error) {
      console.error("Error during mining process:", error);
    } finally {
      // Release the lock regardless of whether mining was successful or not
      await releaseLock("miningLock");
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
        
  
        // Reset In-Memory Chain
        this.chain = [];
  
        // Add New Chain
        for (const blockData of newChainData) {
          const newBlock = Block.fromJSON(blockData);
          await newBlock.save();
          this.chain.push(newBlock);
        }
  
        console.log("Replaced local chain with the received full chain.");
        this.isSynchronized = true;
        broadcastChain(); // Notify other peers about the updated chain
      } catch (err) {
        console.error("Error replacing chain:", err);
      }
    } else {
      console.log("Received chain does not have higher cumulative difficulty.");
    }
  }
  
  

  async getBalanceOfAddress(address) {
    const query = `
      SELECT balance 
      FROM address_balances 
      WHERE address = ?
    `;


    try {
      const [rows, fields] = await db.query(query, [address]);
      if (rows.length === 0) {
        return new Decimal(0).toFixed(8);
      } else {
        const balance = rows[0].balance || 0;
        return new Decimal(balance).toFixed(8);
      }
    } catch (err) {
      throw err;
    }
  }

  // Static method to validate an entire chain
  static async isValidChain(chainData) {
    if (chainData.length === 0) return false;
  
    const firstBlock = chainData[0];
    // Validate genesis block
    if (firstBlock.index !== 0 || (firstBlock.previous_hash !== null && firstBlock.previous_hash !== '0')) {
      console.log("Invalid genesis block.");
      return false;
    }
  
    // Continue with the rest of the validation without early return
    for (let i = 1; i < chainData.length; i++) {
      const currentBlock = chainData[i];
      const previousBlock = chainData[i - 1];
  
      // Validate previous hash linkage
      if (currentBlock.previous_hash !== previousBlock.hash) {
        console.log(`Block ${currentBlock.index} has invalid previous hash.`);
        return false;
      }
  
      // Recalculate and verify hash
      const tempBlock = Block.fromJSON(currentBlock);
      if (currentBlock.hash !== tempBlock.calculateHash()) { // Ensure using correct hash calculation method
        console.log(`Block ${currentBlock.index} has invalid hash.`);
        return false;
      }
  
      // Verify difficulty
      if (currentBlock.hash.substring(0, currentBlock.difficulty) !== Array(currentBlock.difficulty + 1).join("0")) {
        console.log(`Block ${currentBlock.index} does not meet difficulty requirements.`);
        return false;
      }
  
      // Validate all transactions within the block
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
      // Clear the existing chain to prevent duplication
      this.chain = [];
      
      const [rows, fields] = await db.query(query);
      for (const result of rows) {
        const block = await Block.load(result.hash);
        if (block) {
          this.chain.push(block);
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

    const query = `DELETE FROM pending_transactions WHERE hash IN (${transactionHashes.map(() => '?').join(', ')})`;
    try {
        await db.query(query, transactionHashes);
       
    } catch (err) {
        console.error("Error clearing mined transactions from the database:", err);
        throw err;
    }
  }

  async validateDatabaseState() {
    // Fetch all transactions from the blockchain
    const transactions = await this.getAllTransactions();

    // Calculate expected balances
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

    // Compare with database balances
    for (const [address, balance] of Object.entries(calculatedBalances)) {
      // Special handling for "null" address
      if (address === "null") {
        const nullAddressBalance = await this.getBalanceOfAddress("null");
        if (new Decimal(nullAddressBalance).toFixed(8) !== "0.00000000") {
          console.error(`Balance mismatch for null address: expected 0.00000000, found ${nullAddressBalance}`);
          return false;
        }
        continue; // Skip the "null" address in the general balance check
      }

      const dbBalance = await this.getBalanceOfAddress(address);

      if (!balance.equals(new Decimal(dbBalance))) {
        console.error(`Balance mismatch for address ${address}: expected ${balance.toFixed(8)}, found ${dbBalance}`);

        // Fetch transactions from blockchain to identify the cause of discrepancy
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
}

const blockchainInstance = new Blockchain();

export {
  blockchainInstance,
  Blockchain,
  Transaction,
  Block,
};
