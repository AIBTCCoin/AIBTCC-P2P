"use strict";

import crypto from 'crypto'; // Required for creating cryptographic hashes
import elliptic from 'elliptic';
const { ec: EC } = elliptic;
import { db } from './db.js'; // Database module for interacting with the database
import {MerkleTree, MerkleProofPath} from './merkleTree.js'; // Importing MerkleTree and Node classes

import { createNewWallet, loadWallet } from './wallet.js';

import util from 'util';
import Decimal from'decimal.js';

const ec = new EC("secp256k1"); // Initialize the elliptic curve for cryptography

const queryAsync = util.promisify(db.query).bind(db);

class Transaction {
  constructor(
    fromAddress,
    toAddress,
    amount,
    timestamp = Date.now(),
    signature = null,
    blockHash = "",
    originTransactionHash = null,
    publicKey = "",
    index_in_block = null
  ) {
    this.fromAddress = fromAddress; // Address sending the funds
    this.toAddress = toAddress; // Address receiving the funds
    this.amount = amount; // Amount of funds being transferred
    this.timestamp = timestamp; // Timestamp of when the transaction was created
    this.signature = signature; // Digital signature for transaction validation
    this.blockHash = blockHash; // Hash of the block this transaction is included in (if any)
    this.originTransactionHash = originTransactionHash;
    this.publicKey = publicKey; 
    this.hash = this.calculateHash(); // Calculate the transaction hash
    this.index_in_block = index_in_block;
  }

  toJSON() {
    return {
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: new Decimal(this.amount).toFixed(8), // Ensure consistent formatting
      timestamp: this.timestamp,
      signature: this.signature,
      blockHash: this.blockHash,
      originTransactionHash: this.originTransactionHash,
      publicKey: this.publicKey,
      hash: this.hash,
      index_in_block: this.index_in_block 
    };
  }
  
  static fromJSON(data) {
    const tx = new Transaction(
      data.fromAddress,
      data.toAddress,
      data.amount,
      data.timestamp,
      data.signature,
      data.blockHash,
      data.originTransactionHash,
      data.publicKey,
      data.index_in_block
    );
    tx.hash = data.hash;
    return tx;
  }

  // Calculate the hash of the transaction
  calculateHash() {
    const amountStr = new Decimal(this.amount).toFixed(8); // Ensure consistent decimal formatting
    const originHashStr = this.originTransactionHash || ''; // Use empty string if null
    return crypto
      .createHash("sha256")
      .update(
        this.fromAddress +
          this.toAddress +
          amountStr +
          originHashStr +
          this.timestamp
      )
      .digest("hex");
  }

  async signWithAddress(address) {
    try {
      const wallet = loadWallet(address);
      const privateKey = wallet.privateKey;
      const keyPair = ec.keyFromPrivate(privateKey);
      const publicKey = keyPair.getPublic('hex'); 
      
      // Sign the transaction
      const hashTx = this.calculateHash();
      //console.log(`Signing transaction with hash: ${hashTx}`);
      const signature = keyPair.sign(hashTx, 'hex');
      this.signature = signature.toDER('hex');
      this.publicKey = publicKey;
    } catch (error) {
      throw new Error('Failed to sign with address: ' + error.message);
    }
  }
  
  // Validate the transaction
  isValid() {
    const hashToVerify = this.calculateHash();
  
    if (this.fromAddress === null) return true; // Mining rewards
  
    if (!this.signature || this.signature.length === 0) {
      throw new Error("Transaction signature is missing or invalid!");
    }
  
    try {
      // Check if publicKey is present
      if (!this.publicKey || this.publicKey.length === 0) {
        throw new Error("Public key is missing!");
      }
  
      const key = ec.keyFromPublic(this.publicKey, "hex"); // Use publicKey instead of fromAddress
      const isValid = key.verify(hashToVerify, this.signature);
      return isValid;
    } catch (error) {
      throw new Error("Transaction signature is invalid!");
    }
  }

  // Save the transaction to the database
  async save() {
    this.isValid();
  
    const query = "INSERT INTO transactions (hash, from_address, to_address, amount, origin_transaction_hash, timestamp, signature, block_hash, public_key, index_in_block) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const values = [
      this.hash,
      this.fromAddress,
      this.toAddress,
      this.amount,
      this.originTransactionHash,
      this.timestamp,
      this.signature,
      this.blockHash,
      this.publicKey,
      this.index_in_block 
    ];
  
    try {
      const [results] = await db.query(query, values);
      return results;
    } catch (err) {
      throw err;
    }
  }

  // Load a transaction from the database
  static async load(hash) {
    const query = "SELECT * FROM transactions WHERE hash = ?";
    try {
      const [results] = await db.query(query, [hash]);
      if (results.length === 0) {
        return null;
      }
  
      const txData = results[0];
      const tx = new Transaction(
        txData.from_address,
        txData.to_address,
        new Decimal(txData.amount).toFixed(8),
        txData.timestamp,
        txData.signature,
        txData.block_hash,
        txData.origin_transaction_hash,
        txData.public_key,
        txData.index_in_block  
      );
      tx.hash = txData.hash;
  
      // Validate the transaction
      if (!tx.isValid()) {
        throw new Error("Invalid transaction signature!");
      }
  
      return tx;
    } catch (err) {
      console.error("Error loading transaction:", err);
      throw err;
    }
  }
  

  

  async savePending() {
    const query = `
      INSERT INTO pending_transactions (hash, from_address, to_address, amount, timestamp, signature, origin_transaction_hash) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE hash = hash
    `;
    const values = [
      this.calculateHash(),
      this.fromAddress,
      this.toAddress,
      this.amount,
      this.timestamp,
      this.signature,
      this.originTransactionHash,
    ];
  
  
    try {
      await db.query(query, values);

    } catch (err) {
      console.error("Error saving transaction to pending_transactions:", err);
      throw err;
    }
  }
  

  // Load all pending transactions
  static async loadPendingTransactions() {
    const query = "SELECT * FROM pending_transactions";
  
    try {
      const [results] = await db.query(query);
      const transactions = results.map((txData) => {
        const tx = new Transaction(
          txData.from_address,
          txData.to_address,
          txData.amount,
          txData.timestamp,
          txData.signature,
          null, // block_hash is null for pending
          txData.origin_transaction_hash,
          txData.public_key
        );
        tx.hash = txData.hash;
        return tx;
      });
  
      return transactions;
    } catch (err) {
      console.error("Error loading pending transactions:", err);
      throw err;
    }
  }

  static async loadPendingTransactionByHash(hash) {
    const query = "SELECT * FROM pending_transactions WHERE hash = ?";
    try {
      const [results] = await db.query(query, [hash]);
      if (results.length === 0) {
        return null; // Transaction not found
      }
      return Transaction.fromJSON(results[0]); // Return the found transaction
    } catch (err) {
      console.error("Error loading pending transaction by hash:", err);
      throw err;
    }
  }

  // Get the latest transaction for a given address
  static async getLatestTransactionForAddress(address) {
  
    const query = `
      SELECT * 
      FROM transactions 
      WHERE from_address = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;
  
  
    try {
      // Execute the query using await
      const [results] = await db.query(query, [address]);
  
      if (results.length === 0) {
        console.log("No transactions found for address:", address);
        return null;
      }
  
      const txData = results[0];
      const tx = new Transaction(
        txData.from_address,
        txData.to_address,
        txData.amount,
        txData.timestamp,
        txData.signature,
        txData.block_hash,
        txData.origin_transaction_hash,
        txData.public_key
      );
      tx.hash = txData.hash;
  
      return tx;
    } catch (err) {
      console.error("Error fetching latest transaction:", err);
      throw err;
    }
  } 

  verifyTransaction() {
    const expectedHash = this.calculateHash();
    if (this.hash !== expectedHash) {
        console.error("Transaction hash mismatch!");
        console.error(`Stored hash: ${this.hash}`);
        console.error(`Expected hash: ${expectedHash}`);
        console.error(`fromAddress: ${this.fromAddress}`);
        console.error(`toAddress: ${this.toAddress}`);
        console.error(`amount: ${this.amount}`);
        console.error(`originTransactionHash: ${this.originTransactionHash}`);
        console.error(`timestamp: ${this.timestamp}`);  
      throw new Error("Transaction hash does not match expected hash!");
    }
  }
}

export {Transaction};