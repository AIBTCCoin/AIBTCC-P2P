/*const assert = require('assert');
const { Blockchain, Block, Transaction } = require('../src/blockchain'); 
const { createSignedTx } = require('./helpers'); 

let blockObj = null;

beforeEach(function() {
  const transactions = [createSignedTx()];
  const fixedTimestamp = 1625245440000; // Set a fixed timestamp for consistency
  blockObj = new Block(1, 'a1', fixedTimestamp, transactions, 1); // Updated constructor parameters
  blockObj.mineBlock(0); // Adjust difficulty 
});
/*
describe('Block class', function() {
  this.timeout(10000); 
  describe('Constructor', function() {
    it('should correctly save parameters', function() {
      assert.strictEqual(blockObj.previousHash, 'a1');
      assert.ok(blockObj.timestamp); // Check if timestamp is set
      assert.strictEqual(blockObj.transactions.length, 1);
      assert.strictEqual(blockObj.nonce, 0);
      assert.ok(blockObj.merkleRoot); // Check if Merkle root is set
    });

    it('should correctly save parameters, without giving "previousHash"', function() {
      const transactions = [createSignedTx()];
      blockObj = new Block(1, '', Date.now(), transactions, 1);
      assert.strictEqual(blockObj.previousHash, '');
      assert.ok(blockObj.timestamp); // Check if timestamp is set
      assert.strictEqual(blockObj.transactions.length, 1);
      assert.strictEqual(blockObj.nonce, 0);
      assert.ok(blockObj.merkleRoot); // Check if Merkle root is set
    });
  });

  describe('Calculate hash', function() {
    it('should correctly calculate the SHA256', function() {
      const expectedHash = blockObj.calculateHash();
      assert.strictEqual(
        blockObj.hash,
        expectedHash,
        `Expected hash ${expectedHash}, but got ${blockObj.hash}`
      );
    });

    it('should change when we tamper with the tx', function() {
      const origHash = blockObj.calculateHash();
      blockObj.timestamp = Date.now();
      assert.notStrictEqual(blockObj.calculateHash(), origHash);
    });
  });
  
  describe('has valid transactions', function() {
    it('should return true with all valid tx', function() {
      blockObj.transactions = [
        createSignedTx(),
        createSignedTx(),
        createSignedTx()
      ];
      assert(blockObj.hasValidTransactions());
    });

    it('should return false when a single tx is bad', function() {
      const badTx = createSignedTx();
      badTx.amount = 1337; // Adjust field names and tampering logic as needed
      blockObj.transactions = [
        createSignedTx(),
        badTx
      ];
      assert(!blockObj.hasValidTransactions());
    });
  });
});
*/
/*describe('Blockchain', function() {

  describe('minePendingTransactions', function() {
    this.timeout(1000000);
    it('should create 10 blocks for 1000 transactions', async function() {
      
      const blockchain = new Blockchain();
      const miningRewardAddress = 'miner-address';

      // Create 1000 unique transactions
      const transactionSet = new Set();
      while (transactionSet.size < 1000) {
        const tx = createSignedTx();
        if (!transactionSet.has(tx.hash)) {
          transactionSet.add(tx.hash);
          blockchain.pendingTransactions.push(tx);
        }
      }

      // Ensure 1000 unique transactions are added
      assert.strictEqual(blockchain.pendingTransactions.length, 1000);

      // Mine pending transactions
      for (let i = 0; i < 10; i++) {
        await blockchain.minePendingTransactions(miningRewardAddress);
      }

      // Check if 10 blocks have been created
      assert.strictEqual(blockchain.chain.length, 11); // 1 genesis block + 10 mined blocks
    });
  });
  
  describe('Pending transactions', function() {
    it('should save 50 transactions into the pending_transactions table and mine them into a new block', async function() {
      const blockchain = new Blockchain();
      const miningRewardAddress = 'miner-address'; // Replace with a valid reward address
  
      // Add 50 unique transactions
      console.log('Adding 50 transactions...');
      for (let i = 0; i < 50; i++) {
        const tx = createSignedTx();
        blockchain.pendingTransactions.push(tx);
        await tx.savePending(); // Save to the pending_transactions table
      }
      console.log('50 transactions added to the pending_transactions table.');
  
      // Count the pending transactions in the database before mining
      let count = await blockchain.countPendingTransactions();
      console.log(`Pending transactions count before mining: ${count}`);
      assert.strictEqual(count, 50, `Expected 50 pending transactions, but found ${count}`);

      // Log details of pending transactions before mining
      const transactionsBeforeMining = await Transaction.loadPendingTransactions(); // Ensure this method is correct
      console.log('Details of pending transactions before mining:');
      if (transactionsBeforeMining.length === 0) {
        console.log('No pending transactions found.');
      } else {
        transactionsBeforeMining.forEach(tx => {
          console.log(`Transaction Hash: ${tx.hash}, From: ${tx.fromAddress}, To: ${tx.toAddress}, Amount: ${tx.amount}`);
        });
      }
  
      // Mine pending transactions
      console.log('Mining pending transactions...');
      await blockchain.minePendingTransactions(miningRewardAddress);
      console.log('Mining complete.');
  
      // Verify that the pending transactions have been cleared from the database
      count = await blockchain.countPendingTransactions();
      console.log(`Pending transactions count after mining: ${count}`);
      assert.strictEqual(count, 0, `Expected 0 pending transactions after mining, but found ${count}`);
  
      // Verify that a new block was created and contains transactions
      const latestBlock = blockchain.getLatestBlock();
      assert.ok(latestBlock, 'No blocks found in the blockchain');
      console.log(`Latest block found. Number of transactions in the block: ${latestBlock.transactions.length}`);
      assert.strictEqual(latestBlock.transactions.length, 51, `Expected 51 transactions in the block, but found ${latestBlock.transactions.length}`);
  
      // Verify that transactions are correctly mined in the block
      const transactionsInBlock = latestBlock.transactions.map(tx => tx.hash);
      const pendingTransactions = await Transaction.loadPendingTransactions(); // Use Transaction.loadPendingTransactions
      const pendingHashes = pendingTransactions.map(tx => tx.hash);
  
      console.log('Verifying transactions in the block...');
      for (const txHash of pendingHashes) {
        assert.ok(transactionsInBlock.includes(txHash), `Transaction ${txHash} not found in the latest block`);
      }
      console.log('All pending transactions are correctly included in the latest block.');
    });
  });
  */
  /*
  describe('Automatic Mining of Transactions', function() {
    this.timeout(1000000);

    it('should create 5 blocks when 250 transactions are added and the threshold is 50 transactions', async function() {
      const blockchain = new Blockchain();
      const miningRewardAddress = '046c38300a6b0ee526709c1d097cfec49196e477ea318c39c29bbd5e9d7a9b241b44fcdc79bc7ec11fe2231d52ad32ff2653adfde8f6bc4a710caba5e86e1174df'; // Replace with a valid reward address
      const threshold = 50; // The threshold for automatic mining

      // Add 250 unique transactions
      console.log('Adding 250 transactions...');
      for (let i = 0; i < 250; i++) {
        const tx = createSignedTx();
        blockchain.pendingTransactions.push(tx);
        await tx.savePending(); // Save to the pending_transactions table
      }
      console.log('250 transactions added to the pending_transactions table.');

      // Mine pending transactions
      console.log('Mining pending transactions...');
      await blockchain.minePendingTransactions(miningRewardAddress);
      console.log('Mining complete.');

      // Verify that the pending transactions have been cleared from the database
      let count = await blockchain.countPendingTransactions();
      assert.strictEqual(count, 0, `Expected 0 pending transactions after mining, but found ${count}`);

      // Verify that the correct number of blocks were created
      const blocks = blockchain.chain;
      assert.strictEqual(blocks.length, 6, `Expected 6 blocks (1 genesis + 5 mined), but found ${blocks.length}`);

      // Verify the number of transactions in each block
      for (let i = 1; i < blocks.length; i++) { // Skipping genesis block
        const block = blocks[i];
        assert.strictEqual(block.transactions.length, threshold + 1, `Expected ${threshold + 1} transactions in block ${i}, but found ${block.transactions.length}`);
      }

      // Ensure that transactions are correctly included in the blocks
      const allTxHashes = [];
      for (const block of blocks.slice(1)) { // Skipping genesis block
        block.transactions.forEach(tx => allTxHashes.push(tx.hash));
      }

      const pendingTransactions = await Transaction.loadPendingTransactions(); // Use Transaction.loadPendingTransactions
      const pendingHashes = pendingTransactions.map(tx => tx.hash);

      console.log('Verifying transactions in the blocks...');
      for (const txHash of pendingHashes) {
        assert.ok(allTxHashes.includes(txHash), `Transaction ${txHash} not found in any block`);
      }
      console.log('All pending transactions are correctly included in the blocks.');
    });
  });
  
});*/




