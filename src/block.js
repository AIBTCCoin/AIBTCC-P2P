"use strict";

import crypto from "crypto";
import { db } from './db.js';
import { Transaction } from './transaction.js';
import { MerkleTree, MerkleProofPath } from './merkleTree.js';
import Decimal from 'decimal.js';


class Block {
  constructor(index, previousHash, timestamp, transactions, difficulty) {
    this.index = index;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.difficulty = difficulty;
    this.merkleRoot = this.calculateMerkleRoot();
    this.nonce = 0;
    this.originTransactionHash = this.calculateLastOriginTransactionHash(); 
    this.hash = this.calculateHash();
  }

  toJSON() {
    return {
      index: this.index,
      previous_hash: this.previousHash,
      timestamp: this.timestamp,
      nonce: this.nonce,
      difficulty: this.difficulty,
      merkle_root: this.merkleRoot,
      hash: this.hash,
      origin_transaction_hash: this.originTransactionHash,
      transactions: this.transactions.map(tx => tx.toJSON())
    };
  }
  
  static fromJSON(data) {
    const block = new Block(
      data.index,
      data.previous_hash,
      data.timestamp,
      data.transactions.map(txData => Transaction.fromJSON(txData)),
      data.difficulty
    );
    block.hash = data.hash;
    block.nonce = data.nonce;
    block.merkleRoot = data.merkle_root;
    block.originTransactionHash = data.origin_transaction_hash;
    return block;
  }

  // Calculate the Merkle root for the transactions in the block
  calculateMerkleRoot() {
    if (this.transactions.length === 0) {
      return "0".repeat(64); // Return a default hash if there are no transactions
    }
    const hashes = this.transactions.map((tx) => tx.hash); // Get hashes of all transactions
    const merkleTree = new MerkleTree(hashes); // Create a Merkle tree with the transaction hashes
    return merkleTree.getRootHash(); // Get the root hash of the Merkle tree
  }

  calculateLastOriginTransactionHash() {
    if (this.transactions.length === 0) return null;
    
    // Handle the case where the last transaction might be a mining reward with a null originTransactionHash
    const lastTransaction = this.transactions[this.transactions.length - 1];
    if (lastTransaction.originTransactionHash) {
      return lastTransaction.originTransactionHash;
    }
    
    // Return the originTransactionHash of the transaction before the last one
    const secondToLastTransaction = this.transactions[this.transactions.length - 2];
    return secondToLastTransaction ? secondToLastTransaction.originTransactionHash : null;
  }

  // Calculate the hash of the block
  calculateHash() {
    const transactionsData = JSON.stringify(
        this.transactions.map((tx) => {
          return {
            fromAddress: tx.fromAddress,
            toAddress: tx.toAddress,
            amount: new Decimal(tx.amount).toFixed(8),
            timestamp: tx.timestamp,
            signature: tx.signature,
            originTransactionHash: tx.originTransactionHash,
            publicKey: tx.publicKey,
            hash: tx.hash
          };
        })
    );
  
    const dataToHash =
      (this.previousHash || '0') +
      this.timestamp +
      this.merkleRoot +
      this.nonce +
      (this.originTransactionHash || '') +
      transactionsData;

    const hash = crypto
      .createHash("sha256")
      .update(dataToHash)
      .digest("hex");
  
    return hash;
  }

  // Mine the block by finding a hash that meets the difficulty requirements
  mineBlock(difficulty) {
    while (
      this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")
    ) {
      this.nonce++; // Increment the nonce
      this.hash = this.calculateHash(); // Recalculate the block hash
    }
  }

  // Check if all transactions in the block are valid
  async hasValidTransactions() {
    for (const tx of this.transactions) {

      tx.verifyTransaction();

      if (!tx.isValid()) {
        console.error(`Invalid transaction: ${tx.hash}`); // Log invalid transactions
        return false;
      }
    }
    return true; // All transactions are valid
  }

  async save() {
    const query = "INSERT INTO blocks (hash, previous_hash, timestamp, nonce, difficulty, merkle_root, `index`, origin_transaction_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    const values = [
      this.hash,
      this.previousHash,
      this.timestamp,
      this.nonce,
      this.difficulty,
      this.merkleRoot,
      this.index,
      this.originTransactionHash
    ];
    
    try {
      const [results] = await db.query(query, values);

      
      for (let i = 0; i < this.transactions.length; i++) {
        const tx = this.transactions[i];
        tx.blockHash = this.hash;
        tx.index_in_block = i; // Assign the transaction's index
        await tx.save();
            }
      await this.updateBalances(); // Update balances after saving transactions

      const merkleTree = new MerkleTree(
        this.transactions.map((tx) => tx.hash)
      );
  
      await merkleTree.saveNodesToDatabase(this.hash);

      // Store Merkle proofs
      for (const tx of this.transactions) {
        const proof = merkleTree.getProof(tx.hash);
        await this.saveMerkleProof(tx.hash, proof);
      }
  
        return results;
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
        } else {
            console.error(`Error saving block ${this.index}:`, err);
            throw err;
        }
    }
  }
  

  async saveMerkleProof(transactionHash, proof) {
    const query =
      "INSERT INTO merkle_proof_paths (block_hash, transaction_hash, proof_path) VALUES (?, ?, ?)";
    const values = [this.hash, transactionHash, JSON.stringify(proof)];

    try {
      await db.query(query, values);
    } catch (err) {
        console.error(`Error saving proof path for transaction ${transactionHash}:`, err);
      throw err;
    }
  }

  // Load a block from the database
  static async load(hash) {
    const query = "SELECT * FROM blocks WHERE hash = ?";
    try {
      const [results] = await db.query(query, [hash]);
      if (results.length === 0) {
        return null;
      }
  
      const result = results[0];
      const block = new Block(
        result.index,
        result.previous_hash, // null for genesis block
        result.timestamp,
        [],
        result.difficulty
      );
      block.hash = result.hash;
      block.nonce = result.nonce;
      block.merkleRoot = result.merkle_root;
      block.originTransactionHash = result.origin_transaction_hash;
  
      // Load transactions in the correct order
      const txQuery = "SELECT hash FROM transactions WHERE block_hash = ? ORDER BY index_in_block ASC";
      const [txResults] = await db.query(txQuery, [block.hash]);
  
      for (const tx of txResults) {
        const transaction = await Transaction.load(tx.hash);
        if (transaction) {
          if (!transaction.isValid()) {
            console.error(`Invalid transaction in block ${block.index}: ${tx.hash}`);
            throw new Error(`Invalid transaction in block ${block.index}`);
          }
          block.transactions.push(transaction);
        }
      }

      if (block.index !== 0) { // Skip genesis block hash verification
        const recalculatedHash = block.calculateHash();
        if (block.hash !== recalculatedHash) {
            console.error(`Invalid block hash for block ${block.index}:`);
            console.error(`Stored Hash: ${block.hash}`);
            console.error(`Recalculated Hash: ${recalculatedHash}`);
            throw new Error(`Invalid block hash for block ${block.index}`);
        }
      }
  
      return block;
    } catch (err) {
      console.error("Error loading block:", err);
      throw err;
    }
  }
  

  async updateBalances() {
    for (const tx of this.transactions) {
      if (tx.fromAddress) {
        await this.updateAddressBalance(tx.fromAddress, -tx.amount);
      }
      if (tx.toAddress) {
        await this.updateAddressBalance(tx.toAddress, tx.amount);
      }
    }
  }

  

  async updateAddressBalance(address, amount) {
    const query = `
      INSERT INTO address_balances (address, balance)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE balance = balance + ?
    `;
    try {
      await db.query(query, [address, amount, amount]);
    } catch (err) {
      console.error(`Error updating balance for address ${address}:`, err);
      throw err;
    }
  }

  async validateBlockTransactions() {
    for (const tx of this.transactions) {
      // Validate each transaction's hash and signature
      if (!tx.isValid()) {
        console.error(`Invalid transaction: ${tx.hash}`);
        return false;
      }

      // Check if the transaction's state is reflected in the database
      const dbTx = await Transaction.load(tx.hash);
      if (!dbTx || dbTx.calculateHash() !== tx.calculateHash()) {
        console.error(`Transaction ${tx.hash} has been tampered with.`);
        return false;
      }
    }
    return true;
  }
}

export {Block};
