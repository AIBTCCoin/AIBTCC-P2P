const assert = require('assert');
const { Blockchain, Transaction } = require('../src/blockchain');
const { createNewWallet, loadWallet, ec } = require('../src/wallet');
const crypto = require('crypto');

describe('Transaction and Mining Tests', function() {
  this.timeout(100000); // Increase timeout for async operations

  let blockchain;
  let wallets = [];
  let genesisRewardAddress;

  before(async function() {
    // Initialize the blockchain
    blockchain = new Blockchain();

    // Create two wallets to use for transactions
    for (let i = 0; i < 2; i++) {
      const wallet = createNewWallet();
      wallets.push(wallet);
    }

    // Set the mining threshold to 2 transactions
    blockchain.transactionThreshold = 2;

    // The address that receives the genesis reward
    genesisRewardAddress = blockchain.genesisAddress; // Save the genesis block reward recipient address
  });

  it('should generate 1000 transactions and mine every 2 transactions', async function() {
    let previousTransactionHash = null;

    for (let i = 0; i < 1000; i++) {
      const toWallet = wallets[i % 2]; // Alternating recipient wallets

      const fromAddress = genesisRewardAddress; // Always send from the genesis reward address
      const toAddress = toWallet.address;
      const amount = 10;
      const timestamp = Date.now();

      // Create the transaction
      const tx = new Transaction(fromAddress, toAddress, amount, timestamp, null, '', previousTransactionHash);

      // Sign the transaction
      tx.signWithAddress(fromAddress);

      // Save the transaction to pending transactions
      await tx.savePending();
      blockchain.pendingTransactions.push(tx);

      // Update the previousTransactionHash for the next transaction
      previousTransactionHash = tx.hash;

      // If the pending transactions reach the threshold, mine a new block
      if (blockchain.pendingTransactions.length >= blockchain.transactionThreshold) {
        console.log(`Mining block for transactions ${i-1} and ${i}...`);
        await blockchain.minePendingTransactions(blockchain.minerAddress);
        assert.strictEqual(blockchain.pendingTransactions.length, 0, 'Pending transactions should be empty after mining');
      }
    }

    // Ensure that there are no unmined transactions left at the end
    assert.strictEqual(blockchain.pendingTransactions.length, 0, 'All transactions should be mined by the end');

    // Validate the number of blocks created
    const expectedBlocks = 1000 / blockchain.transactionThreshold;
    assert.strictEqual(blockchain.chain.length - 1, expectedBlocks, `Expected ${expectedBlocks} blocks to be created`);
  });
});



