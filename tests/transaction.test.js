/*const assert = require('assert');
const { Transaction, Blockchain } = require('../src/blockchain'); // Adjust path
const { createSignedTx, signingKey } = require('./helpers'); // Ensure these helpers are adapted

const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

describe('Transaction class', function() {
  /*describe('Constructor', function() {
    this.timeout(10000); 
    it('should correctly initialize the transaction', function() {
      const tx = new Transaction('address1', 'address2', 100);
      assert.strictEqual(tx.fromAddress, 'address1');
      assert.strictEqual(tx.toAddress, 'address2');
      assert.strictEqual(tx.amount, 100);
      assert.ok(tx.timestamp);
      assert.strictEqual(tx.signature, null);
    });
  });

  

  describe('Sign', function() {
    it('should sign the transaction', function() {
      const tx = createSignedTx();
      assert.ok(tx.signature);
    });

    it('should fail if trying to sign without the from address', function() {
      const tx = createSignedTx();
      tx.fromAddress = null;
      assert.throws(() => { tx.sign(signingKey); }, Error);
    });
  });

  describe('isValid', function() {
    it('should be valid if signed and has all required fields', function() {
      const tx = createSignedTx();
      assert(tx.isValid());
    });

    it('should fail if the signature is invalid', function() {
      const tx = createSignedTx();
      tx.signature = 'invalid';
      assert(!tx.isValid());
    });

    it('should fail if the transaction is not signed', function() {
      const tx = createSignedTx();
      tx.signature = null;
      assert(!tx.isValid());
    });

    it('should fail if the transaction has a negative amount', function() {
      const tx = createSignedTx();
      tx.amount = -10;
      assert(!tx.isValid());
    });

    it('should fail when not having enough balance', () => {
      const blockchain = new Blockchain();
      
      // Generate a key pair for the test
      const keyPair = ec.genKeyPair();
      const walletAddress = keyPair.getPublic('hex');
      
      // Mine a block to give the wallet some balance
      blockchain.minePendingTransactions(walletAddress);
      
      // Try to create a transaction with an amount larger than the balance
      const tx1 = new Transaction(walletAddress, 'recipientAddress', 150);
      tx1.sign(keyPair);
      
      // Check if the transaction is added to the blockchain's pending transactions
      const added = blockchain.addTransaction(tx1);
    
      // Assert the transaction was not added due to insufficient balance
      assert.strictEqual(added, false);
    });

    it('should fail if the transaction has zero amount', function() {
      const tx = createSignedTx();
      tx.amount = 0;
      assert(!tx.isValid());
    });
  });

  describe('Blockchain accumulation of pending transactions', function() {
    it('should accumulate multiple transactions before mining', function() {
      console.log('Step: Create a new blockchain instance.');
      const blockchain = new Blockchain();

      console.log('Step: Generate key pairs for two wallets.');
      const keyPair1 = ec.genKeyPair();
      const walletAddress1 = keyPair1.getPublic('hex');

      const keyPair2 = ec.genKeyPair();
      const walletAddress2 = keyPair2.getPublic('hex');

      console.log('Step: Mine an initial block to give the first wallet some balance.');
      blockchain.minePendingTransactions(walletAddress1);

      console.log('Mined block with hash:', blockchain.chain[blockchain.chain.length - 1].hash);
      console.log('Transactions in block 1:', JSON.stringify(blockchain.chain[blockchain.chain.length - 1].transactions, null, 2));

      console.log('Step: Create and add multiple transactions to the pending transactions.');
      const tx1 = new Transaction(walletAddress1, walletAddress2, 50);
      tx1.sign(keyPair1);
      blockchain.addTransaction(tx1);

      const tx2 = new Transaction(walletAddress1, walletAddress2, 30);
      tx2.sign(keyPair1);
      blockchain.addTransaction(tx2);

      console.log('Balance of address', walletAddress1 + ':', blockchain.getBalanceOfAddress(walletAddress1));
      console.log('Balance of address', walletAddress2 + ':', blockchain.getBalanceOfAddress(walletAddress2));

      console.log('Step: Mine these transactions to give walletAddress2 a balance.');
      blockchain.minePendingTransactions(walletAddress2);

      console.log('Mined block with hash:', blockchain.chain[blockchain.chain.length - 1].hash);
      console.log('Transactions in block 2:', JSON.stringify(blockchain.chain[blockchain.chain.length - 1].transactions, null, 2));

      console.log('Step: Create and add another transaction from walletAddress2 to walletAddress1.');
      const tx3 = new Transaction(walletAddress2, walletAddress1, 10);
      tx3.sign(keyPair2);
      blockchain.addTransaction(tx3);

      console.log('Balance of address', walletAddress2 + ':', blockchain.getBalanceOfAddress(walletAddress2));

      console.log('Step: Assert that the pending transactions are correctly accumulated.');
      assert.strictEqual(blockchain.pendingTransactions.length, 1);

      console.log('Step: Mine these pending transactions.');
      blockchain.minePendingTransactions(walletAddress1);

      console.log('Mined block with hash:', blockchain.chain[blockchain.chain.length - 1].hash);
      console.log('Transactions in block 3:', JSON.stringify(blockchain.chain[blockchain.chain.length - 1].transactions, null, 2));

      console.log('Step: Check if the pending transactions are cleared from the pending transactions after mining.');
      assert.strictEqual(blockchain.pendingTransactions.length, 0);
    });
  });
});
*/
