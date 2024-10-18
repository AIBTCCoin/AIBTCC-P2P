"use strict";

import crypto from "crypto";
import { db } from './db.js';
import { Transaction } from './transaction.js';
import { MerkleTree, MerkleProofPath } from './merkleTree.js';
import Decimal from 'decimal.js';
import smartContractRunner from './smartContractRunner.js';

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
    let previousHash = data.previous_hash;
  
    // Convert specific string representations to null
    if (previousHash === '0' || previousHash === '' || previousHash === 'null') {
      previousHash = null;
    }

    const block = new Block(
      data.index,
      previousHash,
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
            tokenId: tx.tokenId, // Include tokenId in hash calculation
            timestamp: tx.timestamp,
            signature: tx.signature,
            originTransactionHash: tx.originTransactionHash,
            publicKey: tx.publicKey,
            hash: tx.hash
          };
        })
    );
  
    const dataToHash =
      (this.previousHash || '') +
      this.timestamp +
      this.merkleRoot +
      this.nonce +
      (this.originTransactionHash || '');

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

      if (tx.fromAddress !== null && !tx.isValid()) {
        console.error(`Invalid transaction: ${tx.hash}`);
        return false;
      }
    }
    return true; // All transactions are valid
  }

  async save() {
    const query = `
      INSERT INTO blocks (
        hash, 
        previous_hash, 
        timestamp, 
        nonce, 
        difficulty, 
        merkle_root, 
        \`index\`, 
        origin_transaction_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      this.hash,
      this.previousHash || null,
      this.timestamp,
      this.nonce,
      this.difficulty,
      this.merkleRoot,
      this.index,
      this.originTransactionHash || null 
    ];
    
    try {
      // Insert the block into the blocks table
      const [results] = await db.query(query, values);
  
      // Separate transactions into token creation and regular transactions
      const tokenCreationTransactions = this.transactions.filter(tx => 
        tx.tokenId && tx.tokenName && tx.tokenSymbol && tx.tokenTotalSupply
      );
      const regularTransactions = this.transactions.filter(tx => 
        !(tx.tokenId && tx.tokenName && tx.tokenSymbol && tx.tokenTotalSupply)
      );
  
      // Process token creation transactions
      for (let i = 0; i < tokenCreationTransactions.length; i++) {
        const tx = tokenCreationTransactions[i];
        tx.blockHash = this.hash;
        tx.index_in_block = i; // Assign the transaction's index
  
        // Ensure creator_address exists in address_balances
        const insertAddressQuery = `
          INSERT INTO address_balances (address, balance) 
          VALUES (?, 0.00000000) 
          ON DUPLICATE KEY UPDATE balance = balance
        `;
        await db.query(insertAddressQuery, [tx.toAddress]);
  
        // Insert the token into the tokens table
        const insertTokenQuery = `
          INSERT INTO tokens (
            token_id, 
            name, 
            symbol, 
            total_supply, 
            creator_address, 
            timestamp
          ) VALUES (?, ?, ?, ?, ?, ?) 
          ON DUPLICATE KEY UPDATE 
            name = VALUES(name), 
            symbol = VALUES(symbol), 
            total_supply = VALUES(total_supply), 
            creator_address = VALUES(creator_address), 
            timestamp = VALUES(timestamp)
        `;
        const tokenValues = [
          tx.tokenId, 
          tx.tokenName, 
          tx.tokenSymbol, 
          tx.tokenTotalSupply, 
          tx.toAddress, 
          tx.timestamp
        ];
        const [tokenResult] = await db.query(insertTokenQuery, tokenValues);
  
        // If the token was newly created, update the token balance
        if (tokenResult.affectedRows === 1) { // Token was inserted
          const insertTokenBalanceQuery = `
            INSERT INTO token_balances (address, token_id, balance)
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE balance = balance + ?
          `;
          await db.query(insertTokenBalanceQuery, [tx.toAddress, tx.tokenId, tx.amount, tx.amount]);
        } else {
          // Token already exists; skip balance update to prevent duplication
          console.log(`Token ID ${tx.tokenId} already exists. Skipping balance update.`);
        }
  
        // Save the transaction
        await tx.save();
  
        // Handle smart contract interactions if applicable
        if (tx.method === 'deploy' || (tx.contractId && tx.method)) {
          await this.handleSmartContractInteraction(tx);
        }
      }
  
      // Process regular transactions
      for (let i = 0; i < regularTransactions.length; i++) {
        const tx = regularTransactions[i];
        tx.blockHash = this.hash;
        tx.index_in_block = tokenCreationTransactions.length + i; // Assign the transaction's index

        if (tx.fromAddress) {
          const insertFromAddressQuery = `
            INSERT INTO address_balances (address, balance)
            VALUES (?, 0.00000000)
            ON DUPLICATE KEY UPDATE balance = balance
          `;
          await db.query(insertFromAddressQuery, [tx.fromAddress]);
        }
  
        // Save the transaction
        await tx.save();
        
  
        // Handle smart contract interactions if applicable
        if (tx.method === 'deploy' || (tx.contractId && tx.method)) {
          await this.handleSmartContractInteraction(tx);
        }
      }
  
      // Update balances after saving transactions
      await this.updateBalances(regularTransactions);
  
      // Handle Merkle Tree and proofs
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
        console.error("Duplicate entry detected:", err.message);
      } else {
        console.error(`Error saving block ${this.index}:`, err);
        throw err;
      }
    }
  }
  
  // Helper method to handle smart contract interactions
  async handleSmartContractInteraction(tx) {
    try {
      if (tx.method === 'deploy') {
        await this.deploySmartContractTransaction(tx);
      } else if (tx.contractId && tx.method) {
        await this.executeSmartContractMethod(tx);
      }
    } catch (error) {
      console.error(`Error handling smart contract interaction for transaction ${tx.hash}:`, error.message);
      throw error; // Optionally, implement rollback mechanisms here
    }
  }
  
  async executeSmartContractMethod(tx) {
    const [contractRows] = await db.query("SELECT * FROM smart_contracts WHERE contract_id = ?", [tx.contractId]);
    if (contractRows.length === 0) {
      throw new Error(`Smart contract with ID ${tx.contractId} not found.`);
    }
  
    const contractData = contractRows[0];
    let state = null;
    if (contractData.state) {
      try {
        state = typeof contractData.state === 'string' ? JSON.parse(contractData.state) : contractData.state;
      } catch (error) {
        console.error(`Failed to parse state for contract ID ${tx.contractId}:`, error.message);
        throw new Error(`Invalid state format for contract ID ${tx.contractId}.`);
      }
    }
  
    // Execute the smart contract method
    const { result, updatedState } = await smartContractRunner.executeMethod(
      Buffer.from(contractData.code, 'base64'), // Decode WASM code from base64
      tx.method,
      tx.params,
      tx.hash,
      state
    );
  
    // Ensure updatedState is an object
    if (typeof updatedState !== 'object' || updatedState === null) {
      console.error(`Invalid updatedState returned by smart contract for transaction ${tx.hash}:`, updatedState);
      throw new Error(`Smart contract returned invalid state for transaction ${tx.hash}.`);
    }
  
    // Properly serialize updatedState before storing
    const serializedState = JSON.stringify(updatedState);
  
    // Debugging Logs
    console.log("Updated State Object:", updatedState);
    console.log("Serialized Updated State:", serializedState);
  
    // Update contract state
    await db.query("UPDATE smart_contracts SET state = ? WHERE contract_id = ?", [serializedState, tx.contractId]);
  
    // Save the smart contract transaction result
    const scTxQuery = `
      INSERT INTO smart_contract_transactions (transaction_hash, contract_id, method, params, result)
      VALUES (?, ?, ?, ?, ?)
    `;
    const scTxValues = [
      tx.hash,
      tx.contractId,
      tx.method,
      JSON.stringify(tx.params),
      JSON.stringify(result),
    ];
    await db.query(scTxQuery, scTxValues);
  
    console.log(`Smart contract method '${tx.method}' executed successfully for transaction ${tx.hash}.`);
  }
  
  // Add a new method to handle 'deploy' transactions
  async deploySmartContractTransaction(tx) {
    try {
      console.log(`Deploying smart contract from transaction ${tx.hash}`);
  
      // Extract necessary details from the transaction
      const { params } = tx;
      const { wasmCode, initialState } = params;
  
      if (!wasmCode) {
        throw new Error('WASM code missing in deployment transaction.');
      }
  
      // Initialize the smart contract's state
      const state = initialState || {};
  
      // Insert into smart_contracts table
      const insertContractQuery = `
        INSERT INTO smart_contracts (code, state, creator_address, timestamp)
        VALUES (?, ?, ?, ?)
      `;
      const contractValues = [
        Buffer.from(wasmCode, 'base64'), // Store WASM code as binary
        JSON.stringify(state),
        tx.fromAddress,
        tx.timestamp,
      ];
      const [result] = await db.query(insertContractQuery, contractValues);
  
      const contractId = result.insertId;
      console.log(`Smart contract deployed successfully with ID ${contractId}.`);
  
      // Insert into smart_contract_transactions table
      const scTxQuery = `
        INSERT INTO smart_contract_transactions (transaction_hash, contract_id, method, params, result)
        VALUES (?, ?, ?, ?, ?)
      `;
      const scTxValues = [
        tx.hash,
        contractId,
        'deploy',
        JSON.stringify(tx.params),
        null // Assuming no result for deployment
      ];
      await db.query(scTxQuery, scTxValues);
  
      console.log(`Smart contract deployment transaction processed successfully.`);
    } catch (error) {
      console.error(`Error processing deployment transaction ${tx.hash}:`, error.message);
      throw error; // Re-throw to ensure the block processing is aware of the failure
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
  

  async updateBalances(transactions) {
    for (const tx of transactions) {
      if (tx.fromAddress) {
        await this.updateAddressBalance(tx.fromAddress, -tx.amount, tx.tokenId);
      }
      if (tx.toAddress) {
        await this.updateAddressBalance(tx.toAddress, tx.amount, tx.tokenId);
      }
    }
  }

  

  async updateAddressBalance(address, amount, tokenId = null) {
    if (tokenId === null) {
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
    } else {
      // Ensure the address exists in address_balances
      const insertAddressQuery = `
        INSERT INTO address_balances (address, balance)
        VALUES (?, 0.00000000)
        ON DUPLICATE KEY UPDATE balance = balance
      `;
      await db.query(insertAddressQuery, [address]);
  
      const query = `
        INSERT INTO token_balances (address, token_id, balance)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE balance = balance + ?
      `;
      try {
        await db.query(query, [address, tokenId, amount, amount]);
      } catch (err) {
        console.error(`Error updating token balance for address ${address} and token_id ${tokenId}:`, err);
        throw err;
      }
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

export { Block };



